import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import {
  computeObbOverlapDepth3D,
  validateRobotAssembly,
} from "./assemblyValidation";
import {
  getPoweredWheelAssemblies,
  resolveMotorMechanicalSupport,
  suggestDrivetrainMapping,
  validateDrivetrain,
} from "./drivetrain";
import {
  evaluateComponentAttachmentCompatibility,
  evaluateComponentReplacementImpact,
  evaluateMotorMountCompatibility,
  evaluateMotorWheelCompatibility,
} from "./mechanicalCompatibility";
import { resolvePartMountingInterfaces } from "./mountingInterfaces";
import { compileSimulationConfig } from "../../simulation/logic/simulationConfigCompiler";
import { SimulationWorld } from "../../simulation/logic/simulationWorld";
import type { RobotPart } from "../types/robot.types";

function makeBoxPart(overrides: Partial<RobotPart> & { id: string }): RobotPart {
  return {
    name: overrides.id,
    type: "Structural Block",
    position: [0, 0.25, 0],
    rotation: [0, 0, 0],
    size: [0.4, 0.1, 0.2],
    color: "#64748b",
    mass: 0.5,
    massKg: 0.5,
    geometry: {
      shape: "box",
      length: overrides.size?.[0] ?? 0.4,
      height: overrides.size?.[1] ?? 0.1,
      width: overrides.size?.[2] ?? 0.2,
    },
    ...overrides,
  };
}

describe("Phase 4.8: Mechanical Intelligence & Compatibility", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
  });

  it("evaluates compatible, warning, incompatible, and unknown attachment states honestly", () => {
    const state = useRobotStore.getState();
    const chassis = state.parts.find((p) => p.id === "foundation-chassis")!;

    // 1. Compatible rail on chassis left rail interface
    const rail = makeBoxPart({
      id: "rail-1",
      name: "Side Rail",
      structuralCategory: "rail",
      structuralCatalogueId: "structural-rail",
      size: [0.6, 0.08, 0.08],
      geometry: { shape: "box", length: 0.6, height: 0.08, width: 0.08 },
    });
    const chassisIfaces = resolvePartMountingInterfaces(chassis, state.foundation);
    const railIfaces = resolvePartMountingInterfaces(rail, state.foundation);
    const railEval = evaluateComponentAttachmentCompatibility({
      childPart: rail,
      parentPart: chassis,
      parentInterface: chassisIfaces.find((i) => i.id === "foundation-left-rail"),
      childInterface: railIfaces[0],
      foundation: state.foundation,
    });
    expect(railEval.status).toBe("compatible");

    // 2. Oversized plate on slender bracket -> compatible-with-warnings (dimension span)
    const bracket = makeBoxPart({
      id: "bracket-1",
      structuralCategory: "bracket",
      structuralCatalogueId: "l-bracket",
      size: [0.16, 0.12, 0.14],
      geometry: { shape: "box", length: 0.16, height: 0.12, width: 0.14 },
    });
    const hugePlate = makeBoxPart({
      id: "plate-big",
      name: "Oversized Plate",
      type: "Armor Plate",
      structuralCategory: "plate",
      structuralCatalogueId: "flat-plate",
      size: [1.8, 0.04, 1.4],
      massKg: 6.5,
      geometry: { shape: "box", length: 1.8, height: 0.04, width: 1.4 },
    });
    const oversizedEval = evaluateComponentAttachmentCompatibility({
      childPart: hugePlate,
      parentPart: bracket,
      foundation: state.foundation,
    });
    expect(oversizedEval.status).toBe("compatible-with-warnings");

    // 3. Cannot mount anything onto a rotating Wheel -> incompatible
    const wheel = makeBoxPart({
      id: "wheel-1",
      name: "Wheel",
      type: "Wheel",
      geometry: { shape: "cylinder", diameter: 0.2, axialWidth: 0.06, axis: "x" },
    });
    const wheelParentEval = evaluateComponentAttachmentCompatibility({
      childPart: bracket,
      parentPart: wheel,
    });
    expect(wheelParentEval.status).toBe("incompatible");

    // 4. Unknown interface explicitly surfaces unknown provenance instead of claiming verified
    const unknownParent = makeBoxPart({ id: "mystery-parent", type: "Unknown" as never });
    const unknownEval = evaluateComponentAttachmentCompatibility({
      childPart: rail,
      parentPart: unknownParent,
      parentInterface: {
        id: "unk",
        label: "Custom Interface",
        kind: "unknown",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        compatibleWith: [],
        compatibilityStatus: "unknown",
      },
      childInterface: railIfaces[0],
    });
    expect(unknownEval.status).toBe("unknown");
    expect(["unknown", "mixed"]).toContain(unknownEval.provenanceState);
  });

  it("reports unknown shaft-to-hub specs when absent and detects mismatches when specified", () => {
    const motor = makeBoxPart({
      id: "m1",
      name: "Standard DC Motor",
      type: "Motor",
      motorCatalogueId: "standard-dc",
      position: [0.3, 0.18, 0.32],
      rotation: [0, -Math.PI / 2, 0],
    });
    const wheel = makeBoxPart({
      id: "w1",
      name: "Standard Rubber Wheel",
      type: "Wheel",
      wheelCatalogueId: "standard-rubber",
      position: [0.3, 0.18, 0.45],
      rotation: [0, -Math.PI / 2, 0],
      geometry: { shape: "cylinder", diameter: 0.22, axialWidth: 0.07, axis: "x" },
    });

    // Catalogue parts have compatibleMotorIds but no detailed ShaftInterface/HubInterface -> unknown check surfaced
    const presetEval = evaluateMotorWheelCompatibility({
      motor,
      wheel,
      foundation: useRobotStore.getState().foundation,
    });
    expect(presetEval.status).toBe("unknown");
    expect(
      presetEval.checks.some((c) => c.id === "shaft-hub-unverified" && c.status === "unknown")
    ).toBe(true);

    // Explicit mismatched shaft vs hub -> incompatible error
    const mismatchedMotor: RobotPart = {
      ...motor,
      engineeringSpec: {
        category: "motor" as const,
        generalProvenance: {
          method: "datasheet" as const,
          verified: true,
          source: "test:datasheet",
        },
        shaft: {
          profile: "d-shaft" as const,
          diameterM: 0.008,
          lengthM: 0.03,
        },
      },
    };
    const mismatchedWheel: RobotPart = {
      ...wheel,
      engineeringSpec: {
        category: "wheel" as const,
        generalProvenance: {
          method: "datasheet" as const,
          verified: true,
          source: "test:datasheet",
        },
        hub: {
          profile: "hex" as const,
          boreDiameterM: 0.012,
        },
      },
    };
    const mismatchEval = evaluateMotorWheelCompatibility({
      motor: mismatchedMotor,
      wheel: mismatchedWheel,
    });
    expect(mismatchEval.status).toBe("incompatible");
    expect(
      mismatchEval.checks.some((c) => c.aspect === "shaft-hub-fit" && c.status === "error")
    ).toBe(true);
  });

  it("supports structural-rail motor mounting through wheels, drivetrain auto-map, compiler, and simulation", () => {
    const store = useRobotStore.getState();

    // Add left & right structural rails anchored to foundation-chassis
    const leftRailId = store.addStructuralPart("structural-rail", {
      parentId: "foundation-chassis",
      parentInterfaceId: "foundation-left-rail",
    });
    const rightRailId = store.addStructuralPart("structural-rail", {
      parentId: "foundation-chassis",
      parentInterfaceId: "foundation-right-rail",
    });
    expect(leftRailId).toBeTruthy();
    expect(rightRailId).toBeTruthy();

    // Mount drive motors directly onto those structural rails
    store.selectMotorCatalogueItem("standard-dc");
    const leftMotorId = store.mountMotorToParent(leftRailId!, "rail-left-flange");
    const rightMotorId = store.mountMotorToParent(rightRailId!, "rail-right-flange");
    expect(leftMotorId).toBeTruthy();
    expect(rightMotorId).toBeTruthy();

    // Verify mechanical ancestry traces cleanly back to foundation-chassis
    const afterMotors = useRobotStore.getState();
    const leftMotor = afterMotors.parts.find((p) => p.id === leftMotorId)!;
    const support = resolveMotorMechanicalSupport(
      leftMotor,
      afterMotors.parts,
      afterMotors.connections,
      afterMotors.foundation!
    );
    expect(support.supported).toBe(true);
    expect(support.mountKind).toBe("structural");
    expect(support.ancestorChain).toContain("foundation-chassis");

    // Assign compatible wheels onto both structurally-mounted motors
    afterMotors.selectWheelCatalogueItem("standard-rubber");
    afterMotors.assignWheel(leftMotorId!);
    afterMotors.assignWheel(rightMotorId!);

    const afterWheels = useRobotStore.getState();
    const assemblies = getPoweredWheelAssemblies(
      afterWheels.parts,
      afterWheels.connections,
      afterWheels.foundation
    );
    expect(assemblies).toHaveLength(2);

    // Suggest & validate drivetrain using structural motors
    const suggested = suggestDrivetrainMapping(
      "differential-2",
      afterWheels.parts,
      afterWheels.connections,
      afterWheels.foundation
    );
    const dv = validateDrivetrain(
      suggested,
      afterWheels.parts,
      afterWheels.connections,
      afterWheels.foundation
    );
    expect(dv.isValid).toBe(true);

    afterWheels.applySuggestedDrivetrainMapping(true);
    afterWheels.installBattery("standard-lipo");

    const ready = useRobotStore.getState();
    const compiled = compileSimulationConfig({
      parts: ready.parts,
      connections: ready.connections,
      foundation: ready.foundation,
      drivetrain: ready.drivetrain,
    });
    expect(compiled.success).toBe(true);

    const worldInit = SimulationWorld.fromAssembly({
      parts: ready.parts,
      connections: ready.connections,
      foundation: ready.foundation,
      drivetrain: ready.drivetrain,
    });
    expect(worldInit.success).toBe(true);
    expect(worldInit.world).not.toBeNull();
    worldInit.world!.start();
    worldInit.world!.setDriveControls({ forward: true });
    worldInit.world!.stepFrame(0.05);
    expect(
      worldInit.world!.getTelemetrySnapshot().longitudinalVelocityMps
    ).toBeGreaterThan(0);

    // Unanchored structural motor is explicitly rejected
    ready.detachPart(leftRailId!);
    const detachedState = useRobotStore.getState();
    const detachedLeftMotor = detachedState.parts.find((p) => p.id === leftMotorId)!;
    expect(
      resolveMotorMechanicalSupport(
        detachedLeftMotor,
        detachedState.parts,
        detachedState.connections,
        detachedState.foundation!
      ).supported
    ).toBe(false);
    const report = validateRobotAssembly({
      parts: detachedState.parts,
      connections: detachedState.connections,
      foundation: detachedState.foundation,
      drivetrain: detachedState.drivetrain,
    });
    expect(report.errors.some((d) => d.code === "motor-mount-issue")).toBe(true);
  });

  it("uses 3D OBB SAT overlap to avoid false positives on diagonal rotated parts while catching true intersections", () => {
    const state = useRobotStore.getState();
    const chassis = state.parts.find((p) => p.id === "foundation-chassis")!;
    // foundationModels[1] is 2.0 x 0.35 x 1.5 -> halfLength X = 1.00, halfWidth Z = 0.75

    // Place a 0.9 m x 0.08 m x 0.06 m beam angled -45° parallel to the front-left corner bevel:
    // Center at [1.08, 0.175, 0.83]:
    // Along bevel normal (1,0,1)/sqrt2: chassis reach = (1.0+0.75)/sqrt2 = 1.237m,
    // beam center projection = (1.08+0.83)/sqrt2 = 1.351m, minus half-thickness 0.03m = 1.321m > 1.237m -> zero 3D overlap!
    // Meanwhile its rotated world-AABB minX = 1.08 - 0.34 = 0.74 < 1.00 and minZ = 0.83 - 0.34 = 0.49 < 0.75!
    const diagonalBeam = makeBoxPart({
      id: "diag-beam",
      name: "Angled Wing Brace",
      position: [1.08, 0.175, 0.83],
      rotation: [0, Math.PI / 4, 0],
      size: [0.9, 0.08, 0.06],
      geometry: { shape: "box", length: 0.9, height: 0.08, width: 0.06 },
    });

    expect(computeObbOverlapDepth3D(chassis, diagonalBeam)).toBe(0);

    const noFalseOverlapReport = validateRobotAssembly({
      parts: [...state.parts, diagonalBeam],
      connections: state.connections,
      foundation: state.foundation,
    });
    expect(
      noFalseOverlapReport.warnings.some((d) => d.code === "component-overlap")
    ).toBe(false);

    // Genuine intersection directly penetrating chassis core
    const collidingBeam = makeBoxPart({
      id: "collide-beam",
      name: "Colliding Beam",
      position: [0, 0.18, 0],
      size: [0.5, 0.15, 0.3],
      geometry: { shape: "box", length: 0.5, height: 0.15, width: 0.3 },
    });
    expect(computeObbOverlapDepth3D(chassis, collidingBeam)).toBeGreaterThan(0.05);
    const realOverlapReport = validateRobotAssembly({
      parts: [...state.parts, collidingBeam],
      connections: state.connections,
      foundation: state.foundation,
    });
    const overlapDiag = realOverlapReport.warnings.find(
      (d) => d.code === "component-overlap"
    );
    expect(overlapDiag).toBeDefined();
    expect(overlapDiag?.reason).toBeTruthy();
    expect(overlapDiag?.conditionEvaluated).toBeTruthy();
    expect(overlapDiag?.correctiveAction).toBeTruthy();
  });

  it("evaluates replacement safety, preserves valid child relationships, and supports undo/redo cleanly", () => {
    const store = useRobotStore.getState();
    const plateId = store.addStructuralPart("flat-plate", {
      parentId: "foundation-chassis",
      parentInterfaceId: "foundation-top-center",
    });
    const bracketId = store.addStructuralPart("l-bracket", {
      parentId: plateId!,
    });
    expect(plateId).toBeTruthy();
    expect(bracketId).toBeTruthy();

    const preState = useRobotStore.getState();
    const plateBefore = preState.parts.find((p) => p.id === plateId)!;
    const preChildConn = preState.connections.find(
      (c) => (c.childId ?? c.targetId) === bracketId
    )!;
    expect(preChildConn).toBeDefined();

    // Preview impact before replacing
    const spacerCandidate = makeBoxPart({
      id: plateId!,
      name: "Hex Standoff Post",
      structuralCatalogueId: "hex-standoff",
      structuralCategory: "spacer",
      size: [0.04, 0.12, 0.04],
      massKg: 0.08,
      geometry: { shape: "box", length: 0.04, height: 0.12, width: 0.04 },
    });
    const impact = evaluateComponentReplacementImpact({
      originalPart: plateBefore,
      candidateReplacement: spacerCandidate,
      parts: preState.parts,
      connections: preState.connections,
      foundation: preState.foundation,
    });
    expect(impact.affectedChildren).toHaveLength(1);

    // Replace plate with box-beam and verify no dangling attachments and Undo restores plate cleanly
    preState.replaceStructuralPart(plateId!, "box-beam");
    const afterReplace = useRobotStore.getState();
    const replacedParent = afterReplace.parts.find((p) => p.id === plateId)!;
    expect(replacedParent.structuralCatalogueId).toBe("box-beam");
    const childConnAfter = afterReplace.connections.find(
      (c) => (c.childId ?? c.targetId) === bracketId
    );
    expect(childConnAfter?.parentId).toBe(plateId);

    // Undo restores previous plate & transform
    expect(afterReplace.undo()).toBe(true);
    const undone = useRobotStore.getState();
    expect(
      undone.parts.find((p) => p.id === plateId)?.structuralCatalogueId
    ).toBe("flat-plate");
    expect(undone.redo()).toBe(true);
    expect(
      useRobotStore.getState().parts.find((p) => p.id === plateId)
        ?.structuralCatalogueId
    ).toBe("box-beam");
  });

  it("emits motor mount orientation warnings and subsystem health summaries cleanly", () => {
    const motor = makeBoxPart({
      id: "m-bad-yaw",
      name: "Test Motor",
      type: "Motor",
      motorCatalogueId: "standard-dc",
      position: [0.3, 0.18, 0.3],
      rotation: [0, 0, 0], // points +X forward instead of ±Z lateral
    });
    const mountEval = evaluateMotorMountCompatibility({
      motor,
      parentPart: useRobotStore
        .getState()
        .parts.find((p) => p.id === "foundation-chassis"),
      foundation: useRobotStore.getState().foundation,
    });
    expect(mountEval.status).toBe("compatible-with-warnings");
    expect(
      mountEval.checks.some(
        (c) => c.id === "motor-shaft-orientation" && c.status === "warning"
      )
    ).toBe(true);

    const report = validateRobotAssembly({
      parts: useRobotStore.getState().parts,
      connections: useRobotStore.getState().connections,
      foundation: useRobotStore.getState().foundation,
      drivetrain: useRobotStore.getState().drivetrain,
    });
    expect(report.subsystems.map((s) => s.key)).toEqual([
      "foundation",
      "structural",
      "motors",
      "wheelsAndDrivetrain",
      "compatibility",
    ]);
  });
});
