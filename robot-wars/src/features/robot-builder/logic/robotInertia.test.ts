import { describe, expect, it } from "vitest";
import {
  calculateLocalComponentInertia,
  compileRobotInertiaProfile,
  createZeroInertiaMatrix,
  eulerToRotationMatrix,
  rotateInertiaTensor,
  translateInertiaTensor,
  type InertiaMatrix3x3,
} from "./robotInertia";
import type { RobotPart } from "../types/robot.types";

// Helper builders for analytical test parts
const createMockPart = (
  id: string,
  name: string,
  massKg: number,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  size: [number, number, number] = [0.2, 0.2, 0.2],
  type: RobotPart["type"] = "Structural Block"
): RobotPart => ({
  id,
  name,
  type,
  position,
  rotation,
  size,
  color: "#334155",
  mass: massKg,
  massKg,
});

const createBoxPart = (
  id: string,
  name: string,
  massKg: number,
  dimensions: { length: number; height: number; width: number },
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0]
): RobotPart => ({
  id,
  name,
  type: "Structural Block",
  position,
  rotation,
  size: [dimensions.length, dimensions.height, dimensions.width],
  color: "#334155",
  mass: massKg,
  massKg,
  geometry: {
    shape: "box",
    length: dimensions.length,
    height: dimensions.height,
    width: dimensions.width,
  },
});

const createCylinderPart = (
  id: string,
  name: string,
  massKg: number,
  diameter: number,
  axialWidth: number,
  axis: "x" | "y" | "z" = "x",
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0]
): RobotPart => ({
  id,
  name,
  type: "Wheel",
  position,
  rotation,
  size: [diameter, axialWidth, diameter],
  color: "#1e293b",
  mass: massKg,
  massKg,
  geometry: {
    shape: "cylinder",
    diameter,
    axialWidth,
    axis,
  },
});

describe("robotInertia — Rotation Matrix & Pure Euler XYZ", () => {
  it("generates exact identity matrix for zero rotation", () => {
    const R = eulerToRotationMatrix([0, 0, 0]);
    expect(R[0]).toEqual([1, 0, 0]);
    expect(R[1]).toEqual([0, 1, 0]);
    expect(R[2]).toEqual([0, 0, 1]);
  });

  it("computes exact rotation matrix for pure yaw rotation (+90° about Y)", () => {
    // Rotation by +pi/2 about Y:
    // x' = z, y' = y, z' = -x
    // R = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]
    const R = eulerToRotationMatrix([0, Math.PI / 2, 0]);
    expect(R[0][0]).toBeCloseTo(0, 10);
    expect(R[0][1]).toBeCloseTo(0, 10);
    expect(R[0][2]).toBeCloseTo(1, 10);

    expect(R[1][0]).toBeCloseTo(0, 10);
    expect(R[1][1]).toBeCloseTo(1, 10);
    expect(R[1][2]).toBeCloseTo(0, 10);

    expect(R[2][0]).toBeCloseTo(-1, 10);
    expect(R[2][1]).toBeCloseTo(0, 10);
    expect(R[2][2]).toBeCloseTo(0, 10);
  });

  it("computes exact rotation matrix for pure roll rotation (+90° about X)", () => {
    // Rotation by +pi/2 about X:
    // x' = x, y' = -z, z' = y
    // R = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]
    const R = eulerToRotationMatrix([Math.PI / 2, 0, 0]);
    expect(R[0][0]).toBeCloseTo(1, 10);
    expect(R[1][1]).toBeCloseTo(0, 10);
    expect(R[1][2]).toBeCloseTo(-1, 10);
    expect(R[2][1]).toBeCloseTo(1, 10);
    expect(R[2][2]).toBeCloseTo(0, 10);
  });

  it("computes exact rotation matrix for pure pitch rotation (+90° about Z)", () => {
    // Rotation by +pi/2 about Z:
    // R = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
    const R = eulerToRotationMatrix([0, 0, Math.PI / 2]);
    expect(R[0][0]).toBeCloseTo(0, 10);
    expect(R[0][1]).toBeCloseTo(-1, 10);
    expect(R[1][0]).toBeCloseTo(1, 10);
    expect(R[1][1]).toBeCloseTo(0, 10);
    expect(R[2][2]).toBeCloseTo(1, 10);
  });

  it("matches Three.js numerical transformation for arbitrary compound Euler angles [0.3, 0.4, 0.5]", () => {
    // Pre-calculated benchmark against Three.js new Matrix4().makeRotationFromEuler(new Euler(0.3, 0.4, 0.5, 'XYZ')):
    // Row 0: [ 0.8083070668, -0.4415801631,  0.3894183423]
    // Row 1: [ 0.5590057800,  0.7832138785, -0.2721921353]
    // Row 2: [-0.1848032027,  0.4377019307,  0.8799231763]
    const R = eulerToRotationMatrix([0.3, 0.4, 0.5]);

    expect(R[0][0]).toBeCloseTo(0.8083070668, 6);
    expect(R[0][1]).toBeCloseTo(-0.4415801631, 6);
    expect(R[0][2]).toBeCloseTo(0.3894183423, 6);

    expect(R[1][0]).toBeCloseTo(0.55900578, 6);
    expect(R[1][1]).toBeCloseTo(0.7832138785, 6);
    expect(R[1][2]).toBeCloseTo(-0.2721921353, 6);

    expect(R[2][0]).toBeCloseTo(-0.1848032027, 6);
    expect(R[2][1]).toBeCloseTo(0.4377019307, 6);
    expect(R[2][2]).toBeCloseTo(0.8799231763, 6);
  });
});

describe("robotInertia — Benchmark A: Unit Cube", () => {
  it("calculates exact analytical inertia for 1m x 1m x 1m cube of mass 12kg", () => {
    // L = H = W = 1m, Mass = 12kg
    // Ixx = 12 * (1^2 + 1^2) / 12 = 2 kg·m²
    // Iyy = 12 * (1^2 + 1^2) / 12 = 2 kg·m²
    // Izz = 12 * (1^2 + 1^2) / 12 = 2 kg·m²
    const cube = createBoxPart("cube", "Unit Cube", 12.0, { length: 1, height: 1, width: 1 });
    const local = calculateLocalComponentInertia(cube);

    expect(local.isApproximated).toBe(false);
    expect(local.tensor[0][0]).toBeCloseTo(2.0, 6);
    expect(local.tensor[1][1]).toBeCloseTo(2.0, 6);
    expect(local.tensor[2][2]).toBeCloseTo(2.0, 6);

    // Off-diagonals are zero
    expect(local.tensor[0][1]).toBe(0);
    expect(local.tensor[0][2]).toBe(0);
    expect(local.tensor[1][2]).toBe(0);

    const profile = compileRobotInertiaProfile([cube]);
    expect(profile.validity).toBe("valid");
    expect(profile.totalMassKg).toBe(12.0);
    expect(profile.principalMoments.ixx).toBeCloseTo(2.0, 6);
    expect(profile.principalMoments.iyy).toBeCloseTo(2.0, 6);
    expect(profile.principalMoments.izz).toBeCloseTo(2.0, 6);

    // Radii of gyration: k = sqrt(2 / 12) = sqrt(1/6) ~= 0.408248 m
    expect(profile.radiiOfGyration.kx).toBeCloseTo(Math.sqrt(2 / 12), 6);
    expect(profile.radiiOfGyration.ky).toBeCloseTo(Math.sqrt(2 / 12), 6);
    expect(profile.radiiOfGyration.kz).toBeCloseTo(Math.sqrt(2 / 12), 6);
  });
});

describe("robotInertia — Benchmark B: Solid Cylinder", () => {
  it("calculates exact analytical inertia for D=0.2m (R=0.1m), h=0.1m, M=2kg along X axis", () => {
    // R = 0.1m, h = 0.1m, m = 2kg
    // Iaxial = 0.5 * 2 * 0.1^2 = 0.01 kg·m²
    // Itransverse = (2 * (3 * 0.1^2 + 0.1^2)) / 12 = (2 * 0.04) / 12 = 0.08 / 12 ~= 0.0066666667 kg·m²
    const wheel = createCylinderPart("cyl-x", "Wheel X", 2.0, 0.2, 0.1, "x");
    const local = calculateLocalComponentInertia(wheel);

    expect(local.isApproximated).toBe(false);
    expect(local.tensor[0][0]).toBeCloseTo(0.01, 8);
    expect(local.tensor[1][1]).toBeCloseTo(0.08 / 12, 8);
    expect(local.tensor[2][2]).toBeCloseTo(0.08 / 12, 8);
  });

  it("assigns axial inertia correctly for cylinder axis Y", () => {
    const wheel = createCylinderPart("cyl-y", "Disc Y", 2.0, 0.2, 0.1, "y");
    const local = calculateLocalComponentInertia(wheel);

    expect(local.tensor[0][0]).toBeCloseTo(0.08 / 12, 8);
    expect(local.tensor[1][1]).toBeCloseTo(0.01, 8);
    expect(local.tensor[2][2]).toBeCloseTo(0.08 / 12, 8);
  });

  it("assigns axial inertia correctly for cylinder axis Z", () => {
    const wheel = createCylinderPart("cyl-z", "Roller Z", 2.0, 0.2, 0.1, "z");
    const local = calculateLocalComponentInertia(wheel);

    expect(local.tensor[0][0]).toBeCloseTo(0.08 / 12, 8);
    expect(local.tensor[1][1]).toBeCloseTo(0.08 / 12, 8);
    expect(local.tensor[2][2]).toBeCloseTo(0.01, 8);
  });
});

describe("robotInertia — Benchmark C: Tensor Rotation", () => {
  it("rotates an anisotropic box tensor by +90° around Y axis and verifies exact swap of Ixx and Izz", () => {
    // Anisotropic box: L = 2m, H = 1m, W = 0.5m, M = 12kg
    // Ixx = 12 * (1^2 + 0.5^2) / 12 = 1.25 kg·m²
    // Iyy = 12 * (2^2 + 0.5^2) / 12 = 4.25 kg·m²
    // Izz = 12 * (2^2 + 1^2) / 12 = 5.0 kg·m²
    const box = createBoxPart("aniso", "Aniso Box", 12.0, { length: 2, height: 1, width: 0.5 });
    const local = calculateLocalComponentInertia(box).tensor;

    expect(local[0][0]).toBeCloseTo(1.25, 6);
    expect(local[1][1]).toBeCloseTo(4.25, 6);
    expect(local[2][2]).toBeCloseTo(5.0, 6);

    // Rotate +90° around Y: X rotates to Z, Z rotates to -X
    // Therefore rotated Ixx becomes original Izz (5.0), and rotated Izz becomes original Ixx (1.25)
    // Iyy remains unchanged (4.25)
    const rotated = rotateInertiaTensor(local, [0, Math.PI / 2, 0]);

    expect(rotated[0][0]).toBeCloseTo(5.0, 6);
    expect(rotated[1][1]).toBeCloseTo(4.25, 6);
    expect(rotated[2][2]).toBeCloseTo(1.25, 6);

    // Off-diagonals remain zero
    expect(rotated[0][1]).toBeCloseTo(0, 6);
    expect(rotated[0][2]).toBeCloseTo(0, 6);
    expect(rotated[1][2]).toBeCloseTo(0, 6);
  });

  it("rotates an anisotropic box by +45° around Z axis and validates exact off-diagonal shear coupling", () => {
    // Local: Ixx = 1.25, Iyy = 4.25, Izz = 5.0
    // Rotation by 45° around Z:
    // I'xx = 0.5 * (Ixx + Iyy) = 0.5 * (1.25 + 4.25) = 2.75
    // I'yy = 0.5 * (Ixx + Iyy) = 2.75
    // I'zz = Izz = 5.0
    // I'xy = 0.5 * (Ixx - Iyy) = 0.5 * (1.25 - 4.25) = -1.5
    const initial: InertiaMatrix3x3 = [
      [1.25, 0, 0],
      [0, 4.25, 0],
      [0, 0, 5.0],
    ];

    const rotated = rotateInertiaTensor(initial, [0, 0, Math.PI / 4]);

    expect(rotated[0][0]).toBeCloseTo(2.75, 6);
    expect(rotated[1][1]).toBeCloseTo(2.75, 6);
    expect(rotated[2][2]).toBeCloseTo(5.0, 6);
    expect(rotated[0][1]).toBeCloseTo(-1.5, 6);
    expect(rotated[1][0]).toBeCloseTo(-1.5, 6); // Symmetry
    expect(rotated[0][2]).toBeCloseTo(0, 6);
    expect(rotated[1][2]).toBeCloseTo(0, 6);
  });
});

describe("robotInertia — Benchmark D: Parallel-Axis Theorem", () => {
  it("calculates exact point-mass parallel-axis transfer for mass 5kg displaced by [2, 0, 0]m", () => {
    // Mass = 5kg, d = [2, 0, 0]
    // Ixx = m * (0^2 + 0^2) = 0
    // Iyy = m * (2^2 + 0^2) = 20 kg·m²
    // Izz = m * (2^2 + 0^2) = 20 kg·m²
    const zeroTensor = createZeroInertiaMatrix();
    const transferred = translateInertiaTensor(zeroTensor, 5.0, [2, 0, 0]);

    expect(transferred[0][0]).toBe(0);
    expect(transferred[1][1]).toBe(20.0);
    expect(transferred[2][2]).toBe(20.0);
    expect(transferred[0][1]).toBe(0);
    expect(transferred[0][2]).toBe(0);
    expect(transferred[1][2]).toBe(0);
  });

  it("calculates exact 3D displacement terms including off-diagonal products of inertia", () => {
    // Mass = 2kg, d = [1, 2, 3]m
    // Ixx = 2 * (2^2 + 3^2) = 2 * 13 = 26 kg·m²
    // Iyy = 2 * (1^2 + 3^2) = 2 * 10 = 20 kg·m²
    // Izz = 2 * (1^2 + 2^2) = 2 * 5  = 10 kg·m²
    // Ixy = -2 * (1 * 2) = -4 kg·m²
    // Ixz = -2 * (1 * 3) = -6 kg·m²
    // Iyz = -2 * (2 * 3) = -12 kg·m²
    const zeroTensor = createZeroInertiaMatrix();
    const transferred = translateInertiaTensor(zeroTensor, 2.0, [1, 2, 3]);

    expect(transferred[0][0]).toBeCloseTo(26.0, 6);
    expect(transferred[1][1]).toBeCloseTo(20.0, 6);
    expect(transferred[2][2]).toBeCloseTo(10.0, 6);
    expect(transferred[0][1]).toBeCloseTo(-4.0, 6);
    expect(transferred[1][0]).toBeCloseTo(-4.0, 6);
    expect(transferred[0][2]).toBeCloseTo(-6.0, 6);
    expect(transferred[2][0]).toBeCloseTo(-6.0, 6);
    expect(transferred[1][2]).toBeCloseTo(-12.0, 6);
    expect(transferred[2][1]).toBeCloseTo(-12.0, 6);
  });
});

describe("robotInertia — Benchmark E: Two-Body Symmetrical Assembly", () => {
  it("validates exact total mass, CoM, and cross-term cancellation for two symmetrical bodies", () => {
    // Body 1: 2kg at [0, 0, 1]m (box 0.2 x 0.2 x 0.2)
    // Body 2: 2kg at [0, 0, -1]m (box 0.2 x 0.2 x 0.2)
    // Local for each: m * (0.2^2 + 0.2^2) / 12 = 2 * 0.08 / 12 = 0.16 / 12 ~= 0.0133333 kg·m²
    // CoM = [0, 0, 0], Total Mass = 4kg
    // Transferred for each:
    // Ixx = 0.013333 + 2 * (0 + 1^2) = 2.013333
    // Iyy = 0.013333 + 2 * (0 + 1^2) = 2.013333
    // Izz = 0.013333 + 2 * (0 + 0) = 0.013333
    // Total:
    // Ixx = 2 * 2.013333 = 4.026667
    // Iyy = 2 * 2.013333 = 4.026667
    // Izz = 2 * 0.013333 = 0.026667
    // Off-diagonals are all zero by symmetry
    const b1 = createBoxPart("b1", "Left Body", 2.0, { length: 0.2, height: 0.2, width: 0.2 }, [0, 0, 1]);
    const b2 = createBoxPart("b2", "Right Body", 2.0, { length: 0.2, height: 0.2, width: 0.2 }, [0, 0, -1]);

    const profile = compileRobotInertiaProfile([b1, b2]);

    expect(profile.validity).toBe("valid");
    expect(profile.totalMassKg).toBe(4.0);
    expect(profile.centerOfMass.x).toBeCloseTo(0, 6);
    expect(profile.centerOfMass.y).toBeCloseTo(0, 6);
    expect(profile.centerOfMass.z).toBeCloseTo(0, 6);

    expect(profile.principalMoments.ixx).toBeCloseTo(4.026667, 5);
    expect(profile.principalMoments.iyy).toBeCloseTo(4.026667, 5);
    expect(profile.principalMoments.izz).toBeCloseTo(0.026667, 5);

    // Cross-terms must be zero
    expect(profile.tensor[0][1]).toBeCloseTo(0, 6);
    expect(profile.tensor[0][2]).toBeCloseTo(0, 6);
    expect(profile.tensor[1][2]).toBeCloseTo(0, 6);
  });
});

describe("robotInertia — Benchmark F: Asymmetrical Assembly", () => {
  it("verifies non-zero off-diagonal cross-terms for diagonally offset masses", () => {
    // Body 1: 2kg at [1, 1, 0]
    // Body 2: 2kg at [-1, -1, 0]
    // CoM = [0, 0, 0]
    // Off-diagonal Ixy = -2*(1*1) + -2*(-1*-1) = -4 != 0
    const b1 = createBoxPart("b1", "Diag 1", 2.0, { length: 0.1, height: 0.1, width: 0.1 }, [1, 1, 0]);
    const b2 = createBoxPart("b2", "Diag 2", 2.0, { length: 0.1, height: 0.1, width: 0.1 }, [-1, -1, 0]);

    const profile = compileRobotInertiaProfile([b1, b2]);

    expect(profile.validity).toBe("valid");
    expect(profile.tensor[0][1]).toBeCloseTo(-4.0, 5);
    expect(profile.tensor[1][0]).toBeCloseTo(-4.0, 5);
    // Z is 0 for both, so Ixz and Iyz remain 0
    expect(profile.tensor[0][2]).toBeCloseTo(0, 6);
    expect(profile.tensor[1][2]).toBeCloseTo(0, 6);
  });
});

describe("robotInertia — Benchmark G: Symmetrical 4-Wheel Robot", () => {
  it("validates exact cross-term cancellation (Ixz = 0, Iyz = 0) for a 4-wheel robot layout", () => {
    // Chassis: 10kg at [0, 0.2, 0], 1.2m x 0.2m x 0.8m
    // 4 Wheels at [±0.4, 0.1, ±0.5], 0.5kg each
    // Lateral symmetry (z = ±0.5) ensures all cross terms involving z cancel out
    const chassis = createBoxPart("chassis", "Chassis", 10.0, { length: 1.2, height: 0.2, width: 0.8 }, [0, 0.2, 0]);
    const fl = createCylinderPart("fl", "FL", 0.5, 0.2, 0.08, "x", [0.4, 0.1, 0.5], [0, -Math.PI / 2, 0]);
    const fr = createCylinderPart("fr", "FR", 0.5, 0.2, 0.08, "x", [0.4, 0.1, -0.5], [0, Math.PI / 2, 0]);
    const rl = createCylinderPart("rl", "RL", 0.5, 0.2, 0.08, "x", [-0.4, 0.1, 0.5], [0, -Math.PI / 2, 0]);
    const rr = createCylinderPart("rr", "RR", 0.5, 0.2, 0.08, "x", [-0.4, 0.1, -0.5], [0, Math.PI / 2, 0]);

    const profile = compileRobotInertiaProfile([chassis, fl, fr, rl, rr]);

    expect(profile.validity).toBe("valid");
    expect(profile.totalMassKg).toBe(12.0);

    // Cross-terms involving lateral axis Z must cancel out to 0
    expect(profile.tensor[0][2]).toBeCloseTo(0, 6);
    expect(profile.tensor[2][0]).toBeCloseTo(0, 6);
    expect(profile.tensor[1][2]).toBeCloseTo(0, 6);
    expect(profile.tensor[2][1]).toBeCloseTo(0, 6);

    // Diagonal moments must be strictly positive
    expect(profile.principalMoments.ixx).toBeGreaterThan(0);
    expect(profile.principalMoments.iyy).toBeGreaterThan(0);
    expect(profile.principalMoments.izz).toBeGreaterThan(0);

    // Yaw inertia (Iyy) for a robot is typically largest because mass is spread along X and Z
    expect(profile.principalMoments.iyy).toBeGreaterThan(profile.principalMoments.ixx);
  });
});

describe("robotInertia — Benchmark H: Missing & Degenerate Data Handling", () => {
  it("returns unsupported profile for empty assembly", () => {
    const profile = compileRobotInertiaProfile([]);
    expect(profile.validity).toBe("unsupported");
    expect(profile.totalMassKg).toBe(0);
    expect(profile.principalMoments.ixx).toBe(0);
    expect(profile.warnings.length).toBeGreaterThan(0);
  });

  it("handles non-positive or NaN masses gracefully without crashing", () => {
    const validPart = createBoxPart("valid", "Valid", 5.0, { length: 0.5, height: 0.5, width: 0.5 });
    const nanPart = createMockPart("nan", "NaN Mass", NaN, [1, 1, 1]);
    const zeroPart = createMockPart("zero", "Zero Mass", 0, [1, 1, 1]);

    const profile = compileRobotInertiaProfile([validPart, nanPart, zeroPart]);

    expect(profile.totalMassKg).toBe(5.0);
    expect(profile.validity).toBe("marginal");
    expect(profile.warnings.some((w) => w.includes("NaN Mass"))).toBe(true);
    expect(profile.warnings.some((w) => w.includes("Zero Mass"))).toBe(true);
  });

  it("falls back to Cartesian bounding box extents when canonical geometry is missing", () => {
    const legacyPart = createMockPart("legacy", "Legacy Part", 4.0, [0, 0, 0], [0, 0, 0], [1.0, 0.5, 0.5]);
    // Does not have geometry property
    expect(legacyPart.geometry).toBeUndefined();

    const profile = compileRobotInertiaProfile([legacyPart]);

    expect(profile.validity).toBe("marginal");
    expect(profile.componentInertias[0].isApproximated).toBe(true);
    expect(profile.principalMoments.ixx).toBeGreaterThan(0);
    expect(profile.warnings.some((w) => w.includes("lacks canonical geometry"))).toBe(true);
  });
});
