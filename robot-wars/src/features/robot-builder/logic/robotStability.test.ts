import { describe, expect, it } from "vitest";
import {
  calculateCenterOfMass,
  calculateGroundDatum,
  calculateSupportPolygon,
  calculateWheelLoadDistribution,
  compileRobotStabilityProfile,
  MARGINAL_STABILITY_THRESHOLD_M,
} from "./robotStability";
import { compileRobotPerformanceProfile } from "./robotKinematics";
import type {
  DrivetrainConfiguration,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";

// Helper builders for analytical test parts
const createMockPart = (
  id: string,
  name: string,
  massKg: number,
  position: [number, number, number],
  type: RobotPart["type"] = "Structural Block"
): RobotPart => ({
  id,
  name,
  type,
  position,
  rotation: [0, 0, 0],
  size: [0.2, 0.2, 0.2],
  color: "#334155",
  mass: massKg,
  massKg,
});

const createMockWheel = (
  id: string,
  name: string,
  diameterM: number,
  position: [number, number, number],
  massKg = 0.4,
  staticFrictionCoeff = 0.85
): RobotPart => ({
  id,
  name,
  type: "Wheel",
  position,
  rotation: [0, 0, 0],
  size: [diameterM, 0.08, diameterM],
  color: "#1e293b",
  mass: massKg,
  massKg,
  wheelDiameter: diameterM,
  wheelWidth: 0.08,
  geometry: {
    shape: "cylinder",
    diameter: diameterM,
    axialWidth: 0.08,
    axis: "x",
  },
  engineeringSpec: {
    category: "wheel",
    treadType: "rubber",
    traction: { staticFrictionCoeff },
  },
});

const createMockMotor = (
  id: string,
  stallTorqueNm: number,
  noLoadRpm: number,
  position: [number, number, number],
  massKg = 0.6
): RobotPart => ({
  id,
  name: `Motor ${id}`,
  type: "Motor",
  position,
  rotation: [0, 0, 0],
  size: [0.15, 0.08, 0.08],
  color: "#475569",
  mass: massKg,
  massKg,
  engineeringSpec: {
    category: "motor",
    technology: "brushed-dc",
    electrical: { nominalVoltageV: 12 },
    mechanical: { stallTorqueNm, noLoadSpeedRpm: noLoadRpm },
  },
});

const createMockChassis = (
  lengthM = 1.0,
  widthM = 0.8,
  heightM = 0.2,
  position: [number, number, number] = [0, 0.2, 0],
  massKg = 5.0
): RobotPart => ({
  id: "foundation-chassis",
  name: "Chassis Frame",
  type: "Structural Block",
  position,
  rotation: [0, 0, 0],
  size: [lengthM, heightM, widthM],
  color: "#0f172a",
  mass: massKg,
  massKg,
  foundationModelId: "standard-rectangular",
  geometry: {
    shape: "box",
    length: lengthM,
    width: widthM,
    height: heightM,
  },
  engineeringSpec: {
    category: "structural",
    role: "chassis-frame",
  },
});

const createMockConnection = (
  id: string,
  motorId: string,
  wheelId: string
): RobotConnection => ({
  id,
  sourceId: motorId,
  targetId: wheelId,
  type: "Motor-Wheel",
  parentId: motorId,
  childId: wheelId,
  parentMountPointId: "shaft",
  childMountPointId: "hub",
  relativePosition: [0, 0, 0],
  relativeRotation: [0, 0, 0],
});

describe("robotStability — Center of Mass", () => {
  it("calculates exact CoM for symmetrical 2-part assembly", () => {
    // Part 1 at (-1, 0, 0) with 2 kg; Part 2 at (1, 0, 0) with 2 kg
    const p1 = createMockPart("p1", "Left", 2.0, [-1, 0.5, 0]);
    const p2 = createMockPart("p2", "Right", 2.0, [1, 0.5, 0]);

    const com = calculateCenterOfMass([p1, p2], 0);

    expect(com.totalMassKg).toBe(4.0);
    expect(com.x).toBeCloseTo(0, 6);
    expect(com.y).toBeCloseTo(0.5, 6);
    expect(com.z).toBeCloseTo(0, 6);
    expect(com.heightAboveGroundM).toBeCloseTo(0.5, 6);
    expect(com.validity).toBe("valid");
  });

  it("calculates weighted mass-moment for uneven component masses", () => {
    // 3 kg at x = 0; 1 kg at x = 4 -> xCoM = (3*0 + 1*4) / 4 = 1.0 m
    const p1 = createMockPart("p1", "Heavy", 3.0, [0, 0.2, 0]);
    const p2 = createMockPart("p2", "Light", 1.0, [4.0, 0.2, 0]);

    const com = calculateCenterOfMass([p1, p2], 0);

    expect(com.totalMassKg).toBe(4.0);
    expect(com.x).toBeCloseTo(1.0, 6);
    expect(com.y).toBeCloseTo(0.2, 6);
    expect(com.z).toBeCloseTo(0, 6);
    expect(com.validity).toBe("valid");
  });

  it("computes forward-biased CoM along +X", () => {
    const chassis = createMockPart("c", "Chassis", 2.0, [0, 0.1, 0]);
    const wedge = createMockPart("w", "Front Wedge", 6.0, [0.5, 0.1, 0]);

    // xCoM = (2*0 + 6*0.5) / 8 = 3.0 / 8 = 0.375 m
    const com = calculateCenterOfMass([chassis, wedge], 0);
    expect(com.x).toBeCloseTo(0.375, 5);
  });

  it("computes lateral-biased CoM along +Z", () => {
    const chassis = createMockPart("c", "Chassis", 2.0, [0, 0.1, 0]);
    const arm = createMockPart("a", "Left Arm", 2.0, [0, 0.1, 0.6]);

    // zCoM = (2*0 + 2*0.6) / 4 = 0.3 m
    const com = calculateCenterOfMass([chassis, arm], 0);
    expect(com.z).toBeCloseTo(0.3, 5);
  });

  it("computes vertically elevated CoM and height above ground", () => {
    // Ground datum at 0.05 m; parts at y = 0.2 (2 kg) and y = 0.8 (2 kg) -> yCoM = 0.5
    // height = 0.5 - 0.05 = 0.45 m
    const p1 = createMockPart("p1", "Base", 2.0, [0, 0.2, 0]);
    const p2 = createMockPart("p2", "Tower", 2.0, [0, 0.8, 0]);

    const com = calculateCenterOfMass([p1, p2], 0.05);
    expect(com.y).toBeCloseTo(0.5, 5);
    expect(com.heightAboveGroundM).toBeCloseTo(0.45, 5);
  });

  it("handles missing or invalid mass gracefully without silent omission", () => {
    const validPart = createMockPart("p1", "Valid", 4.0, [0, 0.2, 0]);
    const invalidPart: RobotPart = {
      id: "p2",
      name: "Zero Mass",
      type: "Structural Block",
      position: [1, 1, 1],
      rotation: [0, 0, 0],
      size: [0.1, 0.1, 0.1],
      color: "#000",
      mass: 0,
      massKg: 0,
    };

    const com = calculateCenterOfMass([validPart, invalidPart], 0);
    expect(com.totalMassKg).toBe(4.0);
    expect(com.x).toBeCloseTo(0, 5);
    expect(com.validity).toBe("marginal");
    expect(com.warnings.some((w) => w.includes("Zero Mass"))).toBe(true);
  });

  it("returns unsupported for empty assembly", () => {
    const com = calculateCenterOfMass([], 0);
    expect(com.totalMassKg).toBe(0);
    expect(com.validity).toBe("unsupported");
    expect(com.warnings.length).toBeGreaterThan(0);
  });

  it("returns invalid when all parts have zero or non-finite mass", () => {
    const invalidPart: RobotPart = {
      id: "p1",
      name: "NaN Mass",
      type: "Structural Block",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [0.1, 0.1, 0.1],
      color: "#000",
      mass: NaN,
      massKg: NaN,
    };

    const com = calculateCenterOfMass([invalidPart], 0);
    expect(com.totalMassKg).toBe(0);
    expect(com.validity).toBe("invalid");
  });
});

describe("robotStability — Ground Datum", () => {
  it("determines ground datum from lowest wheel bottom contact point", () => {
    // Wheel 1: pos Y = 0.15, diameter = 0.20 m (radius = 0.10 m) -> bottom = 0.05 m
    // Wheel 2: pos Y = 0.12, diameter = 0.20 m (radius = 0.10 m) -> bottom = 0.02 m
    const w1 = createMockWheel("w1", "W1", 0.2, [0, 0.15, 0.4]);
    const w2 = createMockWheel("w2", "W2", 0.2, [0, 0.12, -0.4]);

    const result = calculateGroundDatum([w1, w2]);
    expect(result.validity).toBe("valid");
    expect(result.groundDatumY).toBeCloseTo(0.02, 5);
  });

  it("falls back to chassis bottom elevation when no wheels exist", () => {
    // Chassis: pos Y = 0.25, height = 0.20 m -> bottom = 0.25 - 0.10 = 0.15 m
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.25, 0]);

    const result = calculateGroundDatum([chassis]);
    expect(result.validity).toBe("marginal");
    expect(result.groundDatumY).toBeCloseTo(0.15, 5);
  });

  it("reports unsupported datum when neither wheels nor chassis exist", () => {
    const result = calculateGroundDatum([]);
    expect(result.validity).toBe("unsupported");
    expect(result.groundDatumY).toBe(0);
  });
});

describe("robotStability — Support Polygon", () => {
  it("constructs a 4-wheel rectangular support polygon with correct area and bounding box", () => {
    // 4 wheels at (+0.4, ±0.5) and (-0.4, ±0.5)
    // dx = 0.8 m, dz = 1.0 m -> Area = 0.8 * 1.0 = 0.8 m²
    const fl = createMockWheel("fl", "FL", 0.2, [0.4, 0.1, 0.5]);
    const fr = createMockWheel("fr", "FR", 0.2, [0.4, 0.1, -0.5]);
    const rl = createMockWheel("rl", "RL", 0.2, [-0.4, 0.1, 0.5]);
    const rr = createMockWheel("rr", "RR", 0.2, [-0.4, 0.1, -0.5]);

    const poly = calculateSupportPolygon([fl, fr, rl, rr]);

    expect(poly.validity).toBe("valid");
    expect(poly.vertices.length).toBe(4);
    expect(poly.areaM2).toBeCloseTo(0.8, 4);
    expect(poly.boundingBox.minX).toBeCloseTo(-0.4, 5);
    expect(poly.boundingBox.maxX).toBeCloseTo(0.4, 5);
    expect(poly.boundingBox.minZ).toBeCloseTo(-0.5, 5);
    expect(poly.boundingBox.maxZ).toBeCloseTo(0.5, 5);
    expect(poly.centroid.x).toBeCloseTo(0, 5);
    expect(poly.centroid.z).toBeCloseTo(0, 5);
  });

  it("constructs a 2-wheel 3-point support triangle with passive front skid", () => {
    // Driven axle at x = 0, track = 1.0 m (z = ±0.5)
    // Chassis length = 1.0 m (x = 0), so front edge is at x = +0.5 m
    // Baseline = 0.5 m, Track = 1.0 m -> Triangle Area = 0.5 * 0.5 * 1.0 = 0.25 m²
    const leftWheel = createMockWheel("wl", "WL", 0.2, [0, 0.1, 0.5]);
    const rightWheel = createMockWheel("wr", "WR", 0.2, [0, 0.1, -0.5]);
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.2, 0]);

    // CoM forward of axle (x = 0.1)
    const poly = calculateSupportPolygon([chassis, leftWheel, rightWheel], null, { x: 0.1, z: 0 });

    expect(poly.validity).toBe("valid");
    expect(poly.vertices.length).toBe(3);
    expect(poly.areaM2).toBeCloseTo(0.25, 4);
    expect(poly.boundingBox.maxX).toBeCloseTo(0.5, 4); // Skid at front
    expect(poly.boundingBox.minX).toBeCloseTo(0.0, 4); // Driven wheels at x = 0
  });

  it("constructs a 2-wheel 3-point support triangle with passive rear skid when CoM is rear-biased", () => {
    const leftWheel = createMockWheel("wl", "WL", 0.2, [0, 0.1, 0.5]);
    const rightWheel = createMockWheel("wr", "WR", 0.2, [0, 0.1, -0.5]);
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.2, 0]);

    // CoM rearward of axle (x = -0.1)
    const poly = calculateSupportPolygon([chassis, leftWheel, rightWheel], null, { x: -0.1, z: 0 });

    expect(poly.validity).toBe("valid");
    expect(poly.vertices.length).toBe(3);
    expect(poly.boundingBox.minX).toBeCloseTo(-0.5, 4); // Skid at rear
    expect(poly.boundingBox.maxX).toBeCloseTo(0.0, 4);  // Driven wheels at x = 0
  });

  it("reports unsupported for degenerate wheel layout (< 0.01 m baseline)", () => {
    // 4 wheels all at the exact same point
    const w1 = createMockWheel("w1", "W1", 0.2, [0, 0.1, 0]);
    const w2 = createMockWheel("w2", "W2", 0.2, [0, 0.1, 0]);
    const w3 = createMockWheel("w3", "W3", 0.2, [0, 0.1, 0]);
    const w4 = createMockWheel("w4", "W4", 0.2, [0, 0.1, 0]);

    const poly = calculateSupportPolygon([w1, w2, w3, w4]);
    expect(poly.validity).toBe("unsupported");
    expect(poly.areaM2).toBe(0);
  });
});

describe("robotStability — 4-Wheel Load Distribution", () => {
  it("divides load equally (25% each) for perfectly symmetrical 4WD robot", () => {
    // 4 wheels at (±0.4, ±0.5), Total mass = 10.0 kg
    // Weight = 10.0 * 9.80665 = 98.0665 N
    // Each wheel should carry exactly 24.5166 N (25%)
    const fl = createMockWheel("fl", "FL", 0.2, [0.4, 0.1, 0.5], 0.5);
    const fr = createMockWheel("fr", "FR", 0.2, [0.4, 0.1, -0.5], 0.5);
    const rl = createMockWheel("rl", "RL", 0.2, [-0.4, 0.1, 0.5], 0.5);
    const rr = createMockWheel("rr", "RR", 0.2, [-0.4, 0.1, -0.5], 0.5);
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.2, 0], 8.0);

    const parts = [chassis, fl, fr, rl, rr];
    const com = calculateCenterOfMass(parts, 0);

    const drivetrain: DrivetrainConfiguration = {
      type: "differential-4",
      left: [{ motorId: "m1", wheelId: "fl" }, { motorId: "m2", wheelId: "rl" }],
      right: [{ motorId: "m3", wheelId: "fr" }, { motorId: "m4", wheelId: "rr" }],
      mappingCustomized: false,
    };

    const dist = calculateWheelLoadDistribution(parts, [], drivetrain, com);

    expect(dist.validity).toBe("valid");
    expect(dist.totalMassKg).toBeCloseTo(10.0, 4);
    expect(dist.totalNormalForceN).toBeCloseTo(98.0665, 3);

    // Per-wheel loads
    for (const w of dist.perWheelLoads) {
      expect(w.loadFraction).toBeCloseTo(0.25, 4);
      expect(w.normalForceN).toBeCloseTo(24.5166, 3);
      expect(w.massEquivalentKg).toBeCloseTo(2.5, 4);
    }

    // Conservation of load: Front + Rear = Total
    expect(dist.frontLoadN! + dist.rearLoadN!).toBeCloseTo(dist.totalNormalForceN, 4);
    // Conservation of load: Left + Right = Total
    expect(dist.leftLoadN! + dist.rightLoadN!).toBeCloseTo(dist.totalNormalForceN, 4);

    // Driven metrics (all 4 wheels driven)
    expect(dist.drivenLoadFraction).toBeCloseTo(1.0, 4);
    expect(dist.drivenNormalForceN).toBeCloseTo(dist.totalNormalForceN, 4);
    expect(dist.drivenMassEquivalentKg).toBeCloseTo(10.0, 4);
  });

  it("distributes load proportionally for forward-biased CoM", () => {
    // Wheelbase = 0.8 m (x = -0.4 to +0.4)
    // CoM at x = +0.2 m (3/4 forward from rear axle)
    // Front wheels should carry 75% of weight, Rear wheels 25%
    const fl = createMockWheel("fl", "FL", 0.2, [0.4, 0.1, 0.5], 0.5);
    const fr = createMockWheel("fr", "FR", 0.2, [0.4, 0.1, -0.5], 0.5);
    const rl = createMockWheel("rl", "RL", 0.2, [-0.4, 0.1, 0.5], 0.5);
    const rr = createMockWheel("rr", "RR", 0.2, [-0.4, 0.1, -0.5], 0.5);
    // Add forward ballast
    const ballast = createMockPart("b", "Ballast", 6.0, [0.3, 0.2, 0]);
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0.1, 0.2, 0], 2.0);

    const parts = [chassis, ballast, fl, fr, rl, rr];
    const com = calculateCenterOfMass(parts, 0);

    const dist = calculateWheelLoadDistribution(parts, [], null, com);

    expect(dist.validity).toBe("valid");
    expect(dist.frontLoadFraction!).toBeGreaterThan(0.65);
    expect(dist.rearLoadFraction!).toBeLessThan(0.35);
    expect(dist.frontLoadFraction! + dist.rearLoadFraction!).toBeCloseTo(1.0, 5);
  });

  it("distributes load proportionally for lateral-biased CoM (left vs right)", () => {
    // Track width = 1.0 m (z = -0.5 to +0.5)
    // Add heavy battery on left side (z = +0.3)
    const fl = createMockWheel("fl", "FL", 0.2, [0.4, 0.1, 0.5], 0.5);
    const fr = createMockWheel("fr", "FR", 0.2, [0.4, 0.1, -0.5], 0.5);
    const rl = createMockWheel("rl", "RL", 0.2, [-0.4, 0.1, 0.5], 0.5);
    const rr = createMockWheel("rr", "RR", 0.2, [-0.4, 0.1, -0.5], 0.5);
    const batt = createMockPart("batt", "Left Battery", 6.0, [0, 0.2, 0.3]);
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.2, 0], 2.0);

    const parts = [chassis, batt, fl, fr, rl, rr];
    const com = calculateCenterOfMass(parts, 0);

    const dist = calculateWheelLoadDistribution(parts, [], null, com);

    expect(dist.validity).toBe("valid");
    expect(dist.leftLoadFraction!).toBeGreaterThan(0.6);
    expect(dist.rightLoadFraction!).toBeLessThan(0.4);
    expect(dist.leftLoadFraction! + dist.rightLoadFraction!).toBeCloseTo(1.0, 5);
  });

  it("flags negative support loads and invalid validity when CoM is outside 4-wheel base", () => {
    // Wheels at x in [-0.4, +0.4]
    // CoM at x = +0.8 m (well beyond front axle)
    const fl = createMockWheel("fl", "FL", 0.2, [0.4, 0.1, 0.5], 0.5);
    const fr = createMockWheel("fr", "FR", 0.2, [0.4, 0.1, -0.5], 0.5);
    const rl = createMockWheel("rl", "RL", 0.2, [-0.4, 0.1, 0.5], 0.5);
    const rr = createMockWheel("rr", "RR", 0.2, [-0.4, 0.1, -0.5], 0.5);
    const extremeBallast = createMockPart("ext", "Ext", 20.0, [1.5, 0.2, 0]);

    const parts = [extremeBallast, fl, fr, rl, rr];
    const com = calculateCenterOfMass(parts, 0);

    const dist = calculateWheelLoadDistribution(parts, [], null, com);

    expect(dist.validity).toBe("invalid");
    // Rear wheels have negative normal forces
    const rearLeft = dist.perWheelLoads.find((w) => w.location === "rear-left");
    expect(rearLeft?.normalForceN).toBeLessThan(0);
    expect(dist.warnings.some((w) => w.includes("Negative normal force"))).toBe(true);
  });
});

describe("robotStability — 2-Wheel 3-Point Support Model", () => {
  it("conserves total vertical load between driven axle and passive skid", () => {
    // Driven axle at x = 0; Front skid at x = +0.5 m; Baseline L = 0.5 m
    // Total Mass = 6.0 kg -> Weight = 58.8399 N
    // CoM at x = +0.15 m (30% toward skid)
    // Skid should carry 30% of weight (17.652 N), Axle should carry 70% (41.188 N)
    const wl = createMockWheel("wl", "WL", 0.2, [0, 0.1, 0.5], 0.5);
    const wr = createMockWheel("wr", "WR", 0.2, [0, 0.1, -0.5], 0.5);
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.2, 0], 5.0);

    // Ballast to put CoM at x = 0.15
    const ballast = createMockPart("b", "B", 3.0, [0.35, 0.2, 0]);
    const parts = [chassis, ballast, wl, wr];
    const com = calculateCenterOfMass(parts, 0);

    const dist = calculateWheelLoadDistribution(parts, [], null, com);

    expect(dist.validity).toBe("valid");
    expect(dist.skidNormalForceN).toBeGreaterThan(0);
    expect(dist.drivenNormalForceN).toBeGreaterThan(0);

    // Load conservation: N_driven + N_skid = W_total
    const sumForces = dist.drivenNormalForceN + dist.skidNormalForceN!;
    expect(sumForces).toBeCloseTo(dist.totalNormalForceN, 4);

    // Fractions sum to 1.0
    expect(dist.drivenLoadFraction + dist.skidLoadFraction!).toBeCloseTo(1.0, 5);
  });

  it("handles neutral CoM directly on driven axle (100% on wheels, 0% on skid)", () => {
    // CoM at x = 0, exactly on axle
    const wl = createMockWheel("wl", "WL", 0.2, [0, 0.1, 0.5], 0.5);
    const wr = createMockWheel("wr", "WR", 0.2, [0, 0.1, -0.5], 0.5);
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.2, 0], 5.0);

    const parts = [chassis, wl, wr];
    const com = calculateCenterOfMass(parts, 0);

    const dist = calculateWheelLoadDistribution(parts, [], null, com);

    expect(dist.validity).toBe("valid");
    expect(dist.drivenLoadFraction).toBeCloseTo(1.0, 4);
    expect(dist.skidLoadFraction).toBeCloseTo(0.0, 4);
  });
});

describe("robotStability — Static Stability & Tipping Angles", () => {
  it("evaluates a symmetrical stable configuration with positive margins and tipping angles", () => {
    // 4 wheels at (±0.4, ±0.5, y = 0.2, radius = 0.2) -> ground at 0.0 m
    // Chassis at (0, 0.2, 0) -> combined CoM at (0, 0.2, 0), Ground at 0 -> h = 0.2 m
    // Forward margin = 0.4 m, Backward margin = 0.4 m
    // Left margin = 0.5 m, Right margin = 0.5 m
    // Tip angle forward = arctan(0.4 / 0.2) = arctan(2.0) ~= 63.43°
    // Tip angle lateral = arctan(0.5 / 0.2) = arctan(2.5) ~= 68.20°
    const fl = createMockWheel("fl", "FL", 0.4, [0.4, 0.2, 0.5], 0.5);
    const fr = createMockWheel("fr", "FR", 0.4, [0.4, 0.2, -0.5], 0.5);
    const rl = createMockWheel("rl", "RL", 0.4, [-0.4, 0.2, 0.5], 0.5);
    const rr = createMockWheel("rr", "RR", 0.4, [-0.4, 0.2, -0.5], 0.5);
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.2, 0], 4.0);

    const parts = [chassis, fl, fr, rl, rr];
    const profile = compileRobotStabilityProfile(parts, []);

    expect(profile.isStaticallyStable).toBe(true);
    expect(profile.stabilityStatus).toBe("stable");
    expect(profile.minimumStabilityMarginM).toBeCloseTo(0.4, 4);
    expect(profile.forwardStabilityMarginM).toBeCloseTo(0.4, 4);
    expect(profile.backwardStabilityMarginM).toBeCloseTo(0.4, 4);
    expect(profile.leftStabilityMarginM).toBeCloseTo(0.5, 4);
    expect(profile.rightStabilityMarginM).toBeCloseTo(0.5, 4);

    expect(profile.forwardTipAngleDeg).toBeCloseTo(63.43, 1);
    expect(profile.backwardTipAngleDeg).toBeCloseTo(63.43, 1);
    expect(profile.leftTipAngleDeg).toBeCloseTo(68.2, 1);
    expect(profile.rightTipAngleDeg).toBeCloseTo(68.2, 1);
    expect(profile.minTipAngleDeg).toBeCloseTo(63.43, 1);
  });

  it("decreases tipping angle for elevated (high) CoM", () => {
    // Wheels at y = 0.2 m (radius 0.2 m -> ground at 0.0 m, mass 4 * 0.5 = 2.0 kg)
    // Low chassis at y = 0.2 m -> combined h = 0.20 m -> forward angle = arctan(0.4 / 0.2) = 63.43°
    // Elevated chassis (4 kg) at y = 0.8 m -> combined y = (4*0.8 + 2*0.2)/6 = 3.6/6 = 0.60 m
    // Forward angle = arctan(0.4 / 0.6) = 33.69°
    const fl = createMockWheel("fl", "FL", 0.4, [0.4, 0.2, 0.5], 0.5);
    const fr = createMockWheel("fr", "FR", 0.4, [0.4, 0.2, -0.5], 0.5);
    const rl = createMockWheel("rl", "RL", 0.4, [-0.4, 0.2, 0.5], 0.5);
    const rr = createMockWheel("rr", "RR", 0.4, [-0.4, 0.2, -0.5], 0.5);
    const lowChassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.2, 0], 4.0);
    const highChassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.8, 0], 4.0);

    const lowProfile = compileRobotStabilityProfile([lowChassis, fl, fr, rl, rr], []);
    const highProfile = compileRobotStabilityProfile([highChassis, fl, fr, rl, rr], []);

    expect(highProfile.isStaticallyStable).toBe(true);
    expect(highProfile.forwardTipAngleDeg!).toBeLessThan(lowProfile.forwardTipAngleDeg!);
    expect(highProfile.forwardTipAngleDeg).toBeCloseTo(33.69, 1);
  });

  it("increases lateral tipping angle for wider track width", () => {
    // Narrow track (z = ±0.3) vs Wide track (z = ±0.8)
    const makeRobotWithTrack = (halfTrack: number) => {
      const fl = createMockWheel("fl", "FL", 0.2, [0.4, 0.1, halfTrack], 0.5);
      const fr = createMockWheel("fr", "FR", 0.2, [0.4, 0.1, -halfTrack], 0.5);
      const rl = createMockWheel("rl", "RL", 0.2, [-0.4, 0.1, halfTrack], 0.5);
      const rr = createMockWheel("rr", "RR", 0.2, [-0.4, 0.1, -halfTrack], 0.5);
      const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.3, 0], 4.0);
      return compileRobotStabilityProfile([chassis, fl, fr, rl, rr], []);
    };

    const narrow = makeRobotWithTrack(0.3);
    const wide = makeRobotWithTrack(0.8);

    expect(wide.leftTipAngleDeg!).toBeGreaterThan(narrow.leftTipAngleDeg!);
  });

  it("flags marginal stability when margin is under threshold (50 mm)", () => {
    // 4 wheels with sum of x moments = 0 (2.0 kg total)
    // Heavy ballast (80 kg) at x = 0.38 m -> xCoM = (80 * 0.38)/82 = 0.3707 m
    // Front edge at 0.40 m -> margin = 0.40 - 0.3707 = 0.0293 m (29.3 mm < 50 mm)
    const fl = createMockWheel("fl", "FL", 0.2, [0.4, 0.1, 0.5], 0.5);
    const fr = createMockWheel("fr", "FR", 0.2, [0.4, 0.1, -0.5], 0.5);
    const rl = createMockWheel("rl", "RL", 0.2, [-0.4, 0.1, 0.5], 0.5);
    const rr = createMockWheel("rr", "RR", 0.2, [-0.4, 0.1, -0.5], 0.5);
    const frontWeight = createMockPart("fw", "Front Ballast", 80.0, [0.38, 0.1, 0]);

    const profile = compileRobotStabilityProfile([frontWeight, fl, fr, rl, rr], []);

    expect(profile.isStaticallyStable).toBe(true);
    expect(profile.stabilityStatus).toBe("marginal");
    expect(profile.minimumStabilityMarginM!).toBeLessThan(MARGINAL_STABILITY_THRESHOLD_M);
  });

  it("reports 0° tipping angles and unstable status when CoM is outside polygon", () => {
    // CoM at x = 1.0 m, well past front boundary of 0.4 m
    const fl = createMockWheel("fl", "FL", 0.2, [0.4, 0.1, 0.5], 0.5);
    const fr = createMockWheel("fr", "FR", 0.2, [0.4, 0.1, -0.5], 0.5);
    const rl = createMockWheel("rl", "RL", 0.2, [-0.4, 0.1, 0.5], 0.5);
    const rr = createMockWheel("rr", "RR", 0.2, [-0.4, 0.1, -0.5], 0.5);
    const tippedWeight = createMockPart("tw", "Tipped Ballast", 20.0, [1.5, 0.1, 0]);

    const profile = compileRobotStabilityProfile([tippedWeight, fl, fr, rl, rr], []);

    expect(profile.isStaticallyStable).toBe(false);
    expect(profile.stabilityStatus).toBe("unstable");
    // Tipping angles must report 0°, not deceptive positive angles
    expect(profile.forwardTipAngleDeg).toBe(0);
    expect(profile.backwardTipAngleDeg).toBe(0);
    expect(profile.leftTipAngleDeg).toBe(0);
    expect(profile.rightTipAngleDeg).toBe(0);
    expect(profile.minTipAngleDeg).toBe(0);
  });
});

describe("Phase 3.6 integration & regression protection", () => {
  it("uses geometry-based driven normal force when stability profile is passed and valid", () => {
    // 2WD robot with CoM positioned so driven wheels carry 75% of mass (rather than nominal 60%)
    // Total Mass = 6.0 kg, Static friction = 0.80
    // 75% load -> N_driven = 6.0 * 0.75 * 9.80665 = 44.1299 N
    // F_traction = 0.80 * 44.1299 = 35.3039 N (nominal 60% would have given 28.243 N)
    const wl = createMockWheel("wl", "WL", 0.2, [0, 0.1, 0.5], 0.5, 0.8);
    const wr = createMockWheel("wr", "WR", 0.2, [0, 0.1, -0.5], 0.5, 0.8);
    const ml = createMockMotor("ml", 2.0, 150, [0, 0.1, 0.4]);
    const mr = createMockMotor("mr", 2.0, 150, [0, 0.1, -0.4]);
    const chassis = createMockChassis(1.0, 0.8, 0.2, [0, 0.2, 0], 3.8);

    const parts = [chassis, ml, mr, wl, wr];
    const connections: RobotConnection[] = [
      createMockConnection("c1", "ml", "wl"),
      createMockConnection("c2", "mr", "wr"),
    ];
    const drivetrain: DrivetrainConfiguration = {
      type: "differential-2",
      left: [{ motorId: "ml", wheelId: "wl" }],
      right: [{ motorId: "mr", wheelId: "wr" }],
      mappingCustomized: false,
    };

    const stability = compileRobotStabilityProfile(parts, connections, drivetrain);
    const performance = compileRobotPerformanceProfile(parts, connections, drivetrain, stability);

    expect(performance.tractionLimitedPushForceN).toBeDefined();
    // Assumption must explicitly state geometry-based calculation
    expect(
      performance.assumptions.some((a) => a.includes("geometry-based driven wheel load"))
    ).toBe(true);
  });

  it("gracefully falls back with explicit assumption note when stability profile is invalid", () => {
    // Invalid stability profile with unstable validity
    const wl = createMockWheel("wl", "WL", 0.2, [0, 0.1, 0.5], 0.5);
    const wr = createMockWheel("wr", "WR", 0.2, [0, 0.1, -0.5], 0.5);
    const ml = createMockMotor("ml", 2.0, 150, [0, 0.1, 0.4]);
    const mr = createMockMotor("mr", 2.0, 150, [0, 0.1, -0.4]);
    const extremeBallast = createMockPart("ext", "Ext", 20.0, [2.5, 0.1, 0]);

    const parts = [extremeBallast, ml, mr, wl, wr];
    const connections: RobotConnection[] = [
      createMockConnection("c1", "ml", "wl"),
      createMockConnection("c2", "mr", "wr"),
    ];
    const drivetrain: DrivetrainConfiguration = {
      type: "differential-2",
      left: [{ motorId: "ml", wheelId: "wl" }],
      right: [{ motorId: "mr", wheelId: "wr" }],
      mappingCustomized: false,
    };

    const stability = compileRobotStabilityProfile(parts, connections, drivetrain);
    const performance = compileRobotPerformanceProfile(parts, connections, drivetrain, stability);

    expect(stability.validity).toBe("invalid");
    // Falls back to nominal 60%
    expect(
      performance.assumptions.some((a) => a.includes("falls back to nominal 60%"))
    ).toBe(true);
  });
});
