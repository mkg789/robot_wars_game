import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { validateRobotAssembly } from "./assemblyValidation";
import {
  buildCustomCollisionConfig,
  resolveImportedEngineeringProperties,
} from "./customCollision";
import {
  clearMeshAssets,
  getMeshAssetRecord,
  getRegisteredAssetCount,
  registerParsedStlAsset,
  releaseMeshAsset,
} from "./meshAssetRegistry";
import { resolvePartMountingInterfaces } from "./mountingInterfaces";
import {
  generateMountingPatternPoints,
  MOUNTING_PITCH_PRESETS,
} from "./mountingPatterns";
import {
  createDefaultProceduralFoundationConfig,
  generateProceduralFoundationAssembly,
  PROCEDURAL_ARCHITECTURES,
  validateProceduralFoundationConfig,
} from "./proceduralFoundation";
import { calculateLocalComponentInertia } from "./robotInertia";
import { calculateCenterOfMass } from "./robotStability";
import {
  buildBinaryStlBuffer,
  computeTransformedStlExtents,
  parseStlArrayBuffer,
} from "./stlParser";
import { compileSimulationConfig } from "../../simulation/logic/simulationConfigCompiler";
import { resolveAssemblySimulationVisualSpec } from "../../simulation/logic/simulationAssembly";
import { SimulationWorld } from "../../simulation/logic/simulationWorld";

/**
 * Generates a closed watertight unit cube centered around [0, 50, 0] with outward normals,
 * sized 200 × 100 × 150 raw units (e.g. millimeters -> 0.2 × 0.1 × 0.15 m).
 */
function createWatertightBoxTriangles(lx = 1000, hy = 200, wz = 800) {
  const hx = lx / 2;
  const hy2 = hy / 2;
  const hz = wz / 2;
  const p = [
    [-hx, -hy2, -hz], // 0
    [hx, -hy2, -hz],  // 1
    [hx, hy2, -hz],   // 2
    [-hx, hy2, -hz],  // 3
    [-hx, -hy2, hz],  // 4
    [hx, -hy2, hz],   // 5
    [hx, hy2, hz],    // 6
    [-hx, hy2, hz],   // 7
  ] as const;

  // 12 CCW triangles forming closed 6-face cuboid
  return [
    [p[0], p[2], p[1]], [p[0], p[3], p[2]], // -Z
    [p[4], p[5], p[6]], [p[4], p[6], p[7]], // +Z
    [p[0], p[1], p[5]], [p[0], p[5], p[4]], // -Y
    [p[3], p[7], p[6]], [p[3], p[6], p[2]], // +Y
    [p[0], p[4], p[7]], [p[0], p[7], p[3]], // -X
    [p[1], p[2], p[6]], [p[1], p[6], p[5]], // +X
  ] as const;
}

describe("Phase 4.9: Foundation Construction & Custom STL Geometry", () => {
  beforeEach(() => {
    clearMeshAssets();
    useRobotStore.getState().startNewBuild();
  });

  it("supports all 6 procedural foundation architectures with identifiable structural members and validation", () => {
    expect(PROCEDURAL_ARCHITECTURES.map((a) => a.id)).toEqual([
      "perimeter-frame",
      "t-slot-frame",
      "patterned-frame",
      "flat-plate",
      "sheet-metal-tray",
      "hybrid",
    ]);

    for (const arch of PROCEDURAL_ARCHITECTURES) {
      const cfg = createDefaultProceduralFoundationConfig(arch.id);
      const val = validateProceduralFoundationConfig(cfg);
      expect(val.isValid).toBe(true);

      const generated = generateProceduralFoundationAssembly({
        modelId: "standard-rectangular",
        length: cfg.length,
        width: cfg.width,
        height: cfg.height,
        includeTopPlate: false,
        includeFrontCover: false,
        confirmed: true,
        mode: "procedural",
        procedural: cfg,
      });

      expect(generated.rootPart.id).toBe("foundation-chassis");
      expect(generated.memberParts.length).toBeGreaterThanOrEqual(1);
      expect(generated.memberConnections.length).toBe(generated.memberParts.length);
      for (const m of generated.memberParts) {
        expect(m.foundationMemberRole).toBeDefined();
        expect(m.massKg).toBeGreaterThan(0);
      }
    }

    // Reject invalid rail dimensions / disabled frame rails
    const badCfg = {
      ...createDefaultProceduralFoundationConfig("perimeter-frame"),
      includeFrontRail: false,
      includeRearRail: false,
      includeLeftRail: false,
      includeRightRail: true,
    };
    const badVal = validateProceduralFoundationConfig(badCfg);
    expect(badVal.isValid).toBe(false);
    expect(badVal.errors.length).toBeGreaterThan(0);
  });

  it("resizes procedural foundations cleanly, updates mounting interfaces, preserves attachments, and supports undo/redo", () => {
    const store = useRobotStore.getState();
    store.configureProceduralFoundation({
      architecture: "t-slot-frame",
      length: 2.0,
      width: 1.4,
      height: 0.16,
      crossmemberCount: 3,
    });
    store.confirmFoundation();

    let state = useRobotStore.getState();
    const crossmembers = state.parts.filter(
      (p) => p.foundationMemberRole === "crossmember"
    );
    expect(crossmembers).toHaveLength(3);

    // Mount a structural bracket onto the chassis and verify resizing keeps it intact
    const bracketId = state.addStructuralPart("l-bracket", {
      parentId: "foundation-chassis",
      parentInterfaceId: "foundation-left-rail",
    });
    expect(bracketId).toBeTruthy();

    useRobotStore.getState().updateFoundationDimensions({ length: 2.5, width: 1.8 });
    state = useRobotStore.getState();
    expect(state.foundation?.length).toBe(2.5);
    expect(state.parts.some((p) => p.id === bracketId)).toBe(true);

    const leftRail = state.parts.find(
      (p) => p.id === "foundation-member-left-rail"
    );
    expect(leftRail?.size[0]).toBeCloseTo(2.5, 4);
    expect(leftRail?.position[2]).toBeGreaterThan(0.8);

    // Undo restores previous 2.0m length cleanly
    expect(state.undo()).toBe(true);
    expect(useRobotStore.getState().foundation?.length).toBe(2.0);
    expect(useRobotStore.getState().redo()).toBe(true);
    expect(useRobotStore.getState().foundation?.length).toBe(2.5);
  });

  it("generates configurable mounting patterns (grid, linear, t-slot, custom) without uncapped meshes", () => {
    expect(MOUNTING_PITCH_PRESETS.some((p) => p.pitchM === 0.01)).toBe(true);
    expect(MOUNTING_PITCH_PRESETS.some((p) => p.pitchM === 0.0127)).toBe(true);

    // Very dense 10 mm grid on 1.5 x 1.2 m deck must cap rendered points deterministically
    const denseResult = generateMountingPatternPoints({
      id: "dense",
      label: "Dense 10mm Deck Grid",
      enabled: true,
      type: "grid",
      origin: [0, 0.1, 0],
      orientation: "top",
      spacingXM: 0.01,
      spacingZM: 0.01,
      boundsLengthM: 1.5,
      boundsWidthM: 1.2,
      holeDiameterM: 0.005,
    });
    expect(denseResult.isValid).toBe(true);
    expect(denseResult.totalLogicalCount).toBeGreaterThan(500);
    expect(denseResult.wasPreviewCapped).toBe(true);
    expect(denseResult.points.length).toBeLessThanOrEqual(196);

    // Custom pattern validation & generation
    const customResult = generateMountingPatternPoints({
      id: "cust",
      label: "Custom Servo Pattern",
      enabled: true,
      type: "custom",
      origin: [0, 0.05, 0],
      orientation: "top",
      spacingXM: 0.02,
      spacingZM: 0.02,
      boundsLengthM: 0.4,
      boundsWidthM: 0.4,
      holeDiameterM: 0.006,
      customPoints: [
        [-0.05, -0.05],
        [0.05, 0.05],
      ],
    });
    expect(customResult.points).toHaveLength(2);
  });

  it("parses both Binary and ASCII STL files, detects open/degenerate geometry, and converts units & orientation", () => {
    const cubeTris = createWatertightBoxTriangles(1200, 300, 900);
    const binBuf = buildBinaryStlBuffer(cubeTris);
    const binParsed = parseStlArrayBuffer(binBuf, "chassis.stl");

    expect(binParsed.inspection.format).toBe("binary");
    expect(binParsed.inspection.triangleCount).toBe(12);
    expect(binParsed.inspection.isClosedManifold).toBe(true);
    expect(binParsed.inspection.rawDimensions[0]).toBeCloseTo(1200, 3);
    expect(binParsed.inspection.rawSignedVolume).toBeCloseTo(1200 * 300 * 900, 0);

    // ASCII STL round-trip
    const asciiStl = `solid test_part
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 100 0 0
    vertex 0 50 0
  endloop
endfacet
endsolid test_part`;
    const asciiBytes = new TextEncoder().encode(asciiStl).buffer;
    const asciiParsed = parseStlArrayBuffer(asciiBytes, "bracket.stl");
    expect(asciiParsed.inspection.format).toBe("ascii");
    expect(asciiParsed.inspection.triangleCount).toBe(1);
    expect(asciiParsed.inspection.isClosedManifold).toBe(false);
    expect(asciiParsed.inspection.openEdgeCount).toBe(3);

    // Unit conversion + CAD Z-up to Y-up rotation
    const extentsMeters = computeTransformedStlExtents({
      rawDimensions: binParsed.inspection.rawDimensions,
      unit: "mm",
      scale: [2, 2, 2],
      orientationRotation: [-Math.PI / 2, 0, 0],
    });
    // X stays 1.2*2=2.4, Y and Z swap under -90 deg X rotation
    expect(extentsMeters[0]).toBeCloseTo(2.4, 3);
    expect(extentsMeters[1]).toBeCloseTo(1.8, 3);
    expect(extentsMeters[2]).toBeCloseTo(0.6, 3);

    // Reject truncated invalid buffer
    expect(() => parseStlArrayBuffer(new ArrayBuffer(20), "bad.stl")).toThrow();
  });

  it("evaluates imported STL engineering properties honestly, builds collision proxies, and feeds stability/inertia", () => {
    const binBuf = buildBinaryStlBuffer(createWatertightBoxTriangles(1500, 200, 1000));
    const parsed = parseStlArrayBuffer(binBuf, "custom-frame.stl");
    const rec = registerParsedStlAsset(parsed);

    const transform = {
      unit: "mm" as const,
      unitConfirmed: false,
      scaleMode: "uniform" as const,
      uniformScale: 1,
      nonUniformScale: [1, 1, 1] as const,
      orientationRotation: [0, 0, 0] as const,
      positionOffset: [0, 0, 0] as const,
    };

    // Closed manifold + aluminum density estimates mass cleanly
    const engEst = resolveImportedEngineeringProperties({
      inspection: parsed.inspection,
      transform,
      materialId: "aluminum-6061",
      massMode: "estimated-density",
      centerOfMassMode: "calculated",
      inertiaMode: "calculated",
    });
    // 1.5 * 0.2 * 1.0 m³ = 0.3 m³ * 2700 kg/m³ = 810 kg solid volume estimate
    expect(engEst.massKg).toBeCloseTo(810, 1);
    expect(engEst.provenance.method).toBe("estimated");
    expect(engEst.inertiaKgM2?.[1]).toBeGreaterThan(0);

    // Unknown mode never fabricates mass or density
    const engUnk = resolveImportedEngineeringProperties({
      inspection: parsed.inspection,
      transform,
      materialId: "unknown",
      massMode: "unknown",
      centerOfMassMode: "unknown",
      inertiaMode: "unknown",
    });
    expect(engUnk.massKg).toBeUndefined();
    expect(engUnk.provenance.method).toBe("unknown");

    // Multi-box collision proxy generation
    const collision = buildCustomCollisionConfig({
      mode: "multi-box",
      extents: [1.5, 0.2, 1.0],
      assetId: rec.assetId,
    });
    expect(collision.boxes.length).toBeGreaterThan(1);
    expect(collision.planarFootprint.lengthM).toBeGreaterThanOrEqual(1.5);
    expect(collision.planarFootprint.lengthM).toBeLessThanOrEqual(1.55);

    // Custom inertia & CoM integrate into robotInertia & robotStability
    const importedPart = {
      id: "foundation-chassis",
      name: "Imported Chassis",
      type: "Structural Block" as const,
      position: [0, 0.1, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      size: [1.5, 0.2, 1.0] as [number, number, number],
      color: "#64748b",
      mass: 4.5,
      massKg: 4.5,
      meshAssetId: rec.assetId,
      meshTransform: transform,
      collisionConfig: collision,
      importedEngineering: {
        ...engEst,
        massMode: "user" as const,
        massKg: 4.5,
        centerOfMassMode: "user" as const,
        centerOfMassLocal: [0.15, 0, 0] as const,
        inertiaMode: "user" as const,
        inertiaKgM2: [1.1, 2.2, 1.5] as const,
      },
      customInertiaKgM2: [1.1, 2.2, 1.5] as [number, number, number],
      geometry: { shape: "box" as const, length: 1.5, height: 0.2, width: 1.0 },
    };

    const inertia = calculateLocalComponentInertia(importedPart);
    expect(inertia.tensor[1][1]).toBeCloseTo(2.2, 5);
    const com = calculateCenterOfMass([importedPart], 0);
    expect(com.x).toBeCloseTo(0.15, 4);

    // Validation catches unconfirmed unit ambiguity cleanly
    const diagReport = validateRobotAssembly({
      parts: [importedPart],
      connections: [],
      foundation: {
        modelId: "standard-rectangular",
        length: 1.5,
        width: 1.0,
        height: 0.2,
        includeTopPlate: false,
        includeFrontCover: false,
        confirmed: true,
        mode: "imported",
      },
    });
    expect(diagReport.warnings.some((d) => d.code === "unit-ambiguity")).toBe(true);

    releaseMeshAsset(rec.assetId);
    expect(getRegisteredAssetCount()).toBe(0);
  });

  it("integrates imported STL foundations, custom mounting interfaces, drivetrain, simulation, and undo/redo lifecycle", () => {
    const store = useRobotStore.getState();
    const binBuf = buildBinaryStlBuffer(createWatertightBoxTriangles(1800, 260, 1400));
    const parsed = parseStlArrayBuffer(binBuf, "hero-chassis.stl");
    const assetRec = registerParsedStlAsset(parsed);

    const transform = {
      unit: "mm" as const,
      unitConfirmed: true,
      scaleMode: "uniform" as const,
      uniformScale: 1,
      nonUniformScale: [1, 1, 1] as const,
      orientationRotation: [0, 0, 0] as const,
      positionOffset: [0, 0, 0] as const,
    };
    const engineering = resolveImportedEngineeringProperties({
      inspection: parsed.inspection,
      transform,
      materialId: "aluminum-6061",
      massMode: "user",
      userMassKg: 6.5,
      centerOfMassMode: "calculated",
      inertiaMode: "calculated",
    });
    const collision = buildCustomCollisionConfig({
      mode: "bounding-box",
      extents: [1.8, 0.26, 1.4],
      assetId: assetRec.assetId,
    });

    store.importFoundationStl({
      assetId: assetRec.assetId,
      fileName: "hero-chassis.stl",
      inspection: parsed.inspection,
      transform,
      engineering,
      collision,
    });
    // Importer preview releases its initial ref leaving store's retained ref active
    releaseMeshAsset(assetRec.assetId);
    expect(getMeshAssetRecord(assetRec.assetId)).not.toBeNull();

    // Author left and right custom motor mounting interfaces directly on the imported STL foundation
    const st1 = useRobotStore.getState();
    st1.addCustomMountingInterface("foundation-chassis", {
      id: "custom-left-motor",
      label: "Custom Left Drive Bay",
      kind: "motor-mount",
      interfaceCategory: "motor-mount",
      position: [0.3, 0, 0.7],
      rotation: [0, -Math.PI / 2, 0],
      compatibleWith: ["motor-mount", "bracket-face", "rail-slot"],
      compatibilityStatus: "compatible",
    });
    st1.addCustomMountingInterface("foundation-chassis", {
      id: "custom-right-motor",
      label: "Custom Right Drive Bay",
      kind: "motor-mount",
      interfaceCategory: "motor-mount",
      position: [0.3, 0, -0.7],
      rotation: [0, Math.PI / 2, 0],
      compatibleWith: ["motor-mount", "bracket-face", "rail-slot"],
      compatibilityStatus: "compatible",
    });

    const chassisWithIfaces = useRobotStore
      .getState()
      .parts.find((p) => p.id === "foundation-chassis")!;
    const resolvedIfaces = resolvePartMountingInterfaces(
      chassisWithIfaces,
      useRobotStore.getState().foundation
    );
    expect(resolvedIfaces.some((i) => i.id === "custom-left-motor")).toBe(true);

    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
    const leftMotorId = useRobotStore
      .getState()
      .mountMotorToParent("foundation-chassis", "custom-left-motor");
    const rightMotorId = useRobotStore
      .getState()
      .mountMotorToParent("foundation-chassis", "custom-right-motor");
    expect(leftMotorId).toBeTruthy();
    expect(rightMotorId).toBeTruthy();

    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().assignWheel(leftMotorId!);
    useRobotStore.getState().assignWheel(rightMotorId!);
    useRobotStore.getState().applySuggestedDrivetrainMapping(true);
    useRobotStore.getState().installBattery("standard-lipo");

    const ready = useRobotStore.getState();
    const compiled = compileSimulationConfig({
      parts: ready.parts,
      connections: ready.connections,
      foundation: ready.foundation,
      drivetrain: ready.drivetrain,
    });
    expect(compiled.success).toBe(true);

    // Visual assembly carries meshAssetId & transform cleanly into Simulation
    const visualSpec = resolveAssemblySimulationVisualSpec({
      parts: ready.parts,
      connections: ready.connections,
      drivetrain: ready.drivetrain,
    });
    expect(
      visualSpec.parts.find((p) => p.partId === "foundation-chassis")?.meshAssetId
    ).toBe(assetRec.assetId);

    const worldInit = SimulationWorld.fromAssembly({
      parts: ready.parts,
      connections: ready.connections,
      foundation: ready.foundation,
      drivetrain: ready.drivetrain,
    });
    expect(worldInit.success).toBe(true);
    worldInit.world!.start();
    worldInit.world!.setDriveControls({ forward: true });
    worldInit.world!.stepFrame(0.05);
    expect(
      worldInit.world!.getTelemetrySnapshot().longitudinalVelocityMps
    ).toBeGreaterThan(0);

    // Resetting build releases unreferenced STL mesh asset memory cleanly
    ready.startNewBuild();
    expect(getRegisteredAssetCount()).toBe(0);
  });
});
