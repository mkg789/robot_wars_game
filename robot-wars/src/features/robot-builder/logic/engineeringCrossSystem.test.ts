import { describe, expect, it } from "vitest";
import type {
  ComponentType,
  DrivetrainConfiguration,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";
import {
  resolveWheelDiameter,
  resolveWheelDimensions,
  resolveWheelRadius,
} from "./geometryAdapters";
import { resolveAssemblyMass, resolveComponentMass } from "./massResolvers";
import { compileRobotInertiaProfile } from "./robotInertia";
import { compileRobotPerformanceProfile } from "./robotKinematics";
import {
  calculateCenterOfMass,
  calculateGroundDatum,
  compileRobotStabilityProfile,
} from "./robotStability";

function createPart(
  id: string,
  name: string,
  type: ComponentType,
  massKg: number | undefined,
  position: [number, number, number],
  opts?: Partial<RobotPart>
): RobotPart {
  return {
    id,
    name,
    type,
    mass: opts?.mass ?? (massKg !== undefined ? massKg : 0),
    massKg,
    position,
    rotation: [0, 0, 0],
    size: [0.2, 0.2, 0.2],
    color: "#888888",
    geometry: {
      shape: "box",
      length: 0.2,
      height: 0.2,
      width: 0.2,
    },
    ...opts,
  };
}

function createCylinderWheel(
  id: string,
  name: string,
  diameter: number,
  axialWidth: number,
  massKg: number,
  position: [number, number, number]
): RobotPart {
  return createPart(id, name, "Wheel", massKg, position, {
    size: [diameter, axialWidth, diameter],
    geometry: {
      shape: "cylinder",
      diameter,
      axialWidth,
      axis: "x",
    },
  });
}

function createBoxChassis(
  id: string,
  name: string,
  length: number,
  height: number,
  width: number,
  massKg: number,
  position: [number, number, number]
): RobotPart {
  return createPart(id, name, "Structural Block", massKg, position, {
    foundationModelId: "standard-rectangular",
    size: [length, height, width],
    geometry: {
      shape: "box",
      length,
      height,
      width,
    },
  });
}

function createMockConnection(
  id: string,
  motorId: string,
  wheelId: string
): RobotConnection {
  return {
    id,
    type: "Motor-Wheel",
    sourceId: motorId,
    targetId: wheelId,
    parentId: motorId,
    childId: wheelId,
    parentMountPointId: "motor-shaft",
    childMountPointId: "wheel-hub",
    relativePosition: [0, 0, 0],
    relativeRotation: [0, 0, 0],
  };
}

describe("engineeringCrossSystem — Cross-System Consistency & Regression", () => {
  describe("1. Cross-System Total Mass Consistency", () => {
    it("reports identical total mass across Kinematics, Stability, and Inertia for valid assemblies", () => {
      const chassis = createBoxChassis("chassis-1", "Chassis", 1.0, 0.2, 0.6, 12.0, [0, 0.1, 0]);
      const motorFL = createPart("m-fl", "Motor FL", "Motor", 1.5, [0.3, 0.1, 0.35]);
      const motorFR = createPart("m-fr", "Motor FR", "Motor", 1.5, [0.3, 0.1, -0.35]);
      const motorRL = createPart("m-rl", "Motor RL", "Motor", 1.5, [-0.3, 0.1, 0.35]);
      const motorRR = createPart("m-rr", "Motor RR", "Motor", 1.5, [-0.3, 0.1, -0.35]);
      const wheelFL = createCylinderWheel("w-fl", "Wheel FL", 0.22, 0.07, 0.8, [0.3, 0.11, 0.4]);
      const wheelFR = createCylinderWheel("w-fr", "Wheel FR", 0.22, 0.07, 0.8, [0.3, 0.11, -0.4]);
      const wheelRL = createCylinderWheel("w-rl", "Wheel RL", 0.22, 0.07, 0.8, [-0.3, 0.11, 0.4]);
      const wheelRR = createCylinderWheel("w-rr", "Wheel RR", 0.22, 0.07, 0.8, [-0.3, 0.11, -0.4]);

      const parts = [chassis, motorFL, motorFR, motorRL, motorRR, wheelFL, wheelFR, wheelRL, wheelRR];
      // Expected total: 12 + 4 * 1.5 + 4 * 0.8 = 12 + 6.0 + 3.2 = 21.2 kg

      const assemblyMass = resolveAssemblyMass(parts);
      expect(assemblyMass.totalMassKg).toBeCloseTo(21.2, 5);

      const com = calculateCenterOfMass(parts);
      expect(com.totalMassKg).toBeCloseTo(21.2, 5);

      const stability = compileRobotStabilityProfile(parts, [], null);
      expect(stability.centerOfMass.totalMassKg).toBeCloseTo(21.2, 5);

      const performance = compileRobotPerformanceProfile(parts, [], null, stability);
      expect(performance.totalMassKg).toBeCloseTo(21.2, 5);

      const inertia = compileRobotInertiaProfile(parts, null, com);
      expect(inertia.totalMassKg).toBeCloseTo(21.2, 5);

      // Verify exact equivalence across all three engines
      expect(performance.totalMassKg).toBe(stability.centerOfMass.totalMassKg);
      expect(stability.centerOfMass.totalMassKg).toBe(inertia.totalMassKg);
    });

    it("filters invalid masses consistently across all three analytical engines", () => {
      const validChassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0, [0, 0.1, 0]);
      expect(resolveComponentMass(validChassis).isValid).toBe(true);

      const zeroPart = createPart("p-zero", "Zero Sensor", "Controller", 0, [0, 0, 0]);
      const negPart = createPart("p-neg", "Negative Armor", "Armor Plate", -3.0, [0, 0, 0]);
      const nanPart = createPart("p-nan", "NaN Battery", "Battery", NaN, [0, 0, 0]);
      const missingPart: RobotPart = {
        ...createPart("p-miss", "Missing Part", "Structural Block", undefined, [0, 0, 0]),
        mass: undefined as unknown as number,
      };
      const legacyPart = createPart("p-legacy", "Legacy Motor", "Motor", undefined, [0, 0, 0], { mass: 2.5 });

      const parts = [validChassis, zeroPart, negPart, nanPart, missingPart, legacyPart];
      // Expected valid total: 10.0 (chassis) + 2.5 (legacy recovered) = 12.5 kg

      const assemblyMass = resolveAssemblyMass(parts);
      expect(assemblyMass.totalMassKg).toBeCloseTo(12.5, 5);
      expect(assemblyMass.invalidComponents).toHaveLength(4);

      const com = calculateCenterOfMass(parts);
      expect(com.totalMassKg).toBeCloseTo(12.5, 5);

      const stability = compileRobotStabilityProfile(parts, [], null);
      expect(stability.centerOfMass.totalMassKg).toBeCloseTo(12.5, 5);

      const performance = compileRobotPerformanceProfile(parts, [], null, stability);
      expect(performance.totalMassKg).toBeCloseTo(12.5, 5);

      const inertia = compileRobotInertiaProfile(parts, null, com);
      expect(inertia.totalMassKg).toBeCloseTo(12.5, 5);

      // Verify exact mathematical parity
      expect(performance.totalMassKg).toBe(stability.centerOfMass.totalMassKg);
      expect(stability.centerOfMass.totalMassKg).toBe(inertia.totalMassKg);

      // Warnings must flag the rejected components
      expect(stability.warnings.some((w) => w.includes("Zero Sensor"))).toBe(true);
      expect(stability.warnings.some((w) => w.includes("Negative Armor"))).toBe(true);
      expect(stability.warnings.some((w) => w.includes("NaN Battery"))).toBe(true);
      expect(stability.warnings.some((w) => w.includes("Missing Part"))).toBe(true);
    });
  });

  describe("2. Wheel Geometry & Contact Consistency", () => {
    it("guarantees identical wheel radius and diameter between Kinematics and Stability ground datum", () => {
      const wheel = createCylinderWheel("w1", "Test Wheel", 0.28, 0.09, 1.2, [0, 0.14, 0]);

      const dim = resolveWheelDimensions(wheel);
      expect(dim.isValid).toBe(true);
      expect(dim.diameterM).toBe(0.28);
      expect(dim.radiusM).toBe(0.14);
      expect(resolveWheelDiameter(wheel)).toBe(0.28);
      expect(resolveWheelRadius(wheel)).toBe(0.14);

      // Stability ground datum lowest wheel bottom calculation: Y - radius = 0.14 - 0.14 = 0.0
      const datum = calculateGroundDatum([wheel]);
      expect(datum.groundDatumY).toBeCloseTo(0.0, 5);
      const stability = compileRobotStabilityProfile([wheel], [], null);
      expect(stability.centerOfMass.groundDatumY).toBeCloseTo(0.0, 5);
    });

    it("rejects non-cylinder shapes when evaluating wheel dimensions", () => {
      const boxAsWheel = createPart("w-fake", "Box Wheel", "Wheel", 1.0, [0, 0, 0], {
        geometry: { shape: "box", length: 0.3, height: 0.1, width: 0.3 },
      });

      const res = resolveWheelDimensions(boxAsWheel);
      expect(res.isValid).toBe(false);
      expect(res.failureReason).toBe("unsupported-shape");
      expect(res.diameterM).toBe(0);
      expect(res.radiusM).toBe(0);
    });
  });

  describe("3. Inertia Terminology & Tensor Representation", () => {
    it("provides bodyMomentsOfInertia with diagonal terms and computes off-diagonal products of inertia", () => {
      const part1 = createBoxChassis("b1", "Body Left", 0.4, 0.2, 0.4, 5.0, [0.3, 0, 0.2]);
      const part2 = createBoxChassis("b2", "Body Right", 0.4, 0.2, 0.4, 5.0, [-0.3, 0, -0.2]);

      const profile = compileRobotInertiaProfile([part1, part2]);
      expect(profile.validity).toBe("valid");

      // Verify body-frame moments are the diagonal components of the 3x3 tensor
      expect(profile.bodyMomentsOfInertia.ixx).toBe(profile.tensor[0][0]);
      expect(profile.bodyMomentsOfInertia.iyy).toBe(profile.tensor[1][1]);
      expect(profile.bodyMomentsOfInertia.izz).toBe(profile.tensor[2][2]);

      // Backward compatibility alias must match exactly
      expect(profile.principalMoments.ixx).toBe(profile.bodyMomentsOfInertia.ixx);
      expect(profile.principalMoments.iyy).toBe(profile.bodyMomentsOfInertia.iyy);
      expect(profile.principalMoments.izz).toBe(profile.bodyMomentsOfInertia.izz);

      // Asymmetrical diagonal placement yields non-zero products of inertia Ixy, Ixz, Iyz
      expect(profile.tensor[0][2]).not.toBe(0); // Ixz product
      expect(profile.tensor[2][0]).toBe(profile.tensor[0][2]); // Symmetry
    });
  });

  describe("4. 4WD End-to-End Regression", () => {
    it("preserves numerical results for a standard 4WD robot across all profiles", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 0.8, 0.2, 0.5, 10.0, [0, 0.1, 0]);
      const mFL = createPart("m-fl", "M FL", "Motor", 1.0, [0.25, 0.1, 0.3]);
      const mFR = createPart("m-fr", "M FR", "Motor", 1.0, [0.25, 0.1, -0.3]);
      const mRL = createPart("m-rl", "M RL", "Motor", 1.0, [-0.25, 0.1, 0.3]);
      const mRR = createPart("m-rr", "M RR", "Motor", 1.0, [-0.25, 0.1, -0.3]);

      const wFL = createCylinderWheel("w-fl", "W FL", 0.2, 0.05, 0.5, [0.25, 0.1, 0.35]);
      const wFR = createCylinderWheel("w-fr", "W FR", 0.2, 0.05, 0.5, [0.25, 0.1, -0.35]);
      const wRL = createCylinderWheel("w-rl", "W RL", 0.2, 0.05, 0.5, [-0.25, 0.1, 0.35]);
      const wRR = createCylinderWheel("w-rr", "W RR", 0.2, 0.05, 0.5, [-0.25, 0.1, -0.35]);

      const parts = [chassis, mFL, mFR, mRL, mRR, wFL, wFR, wRL, wRR];
      // Total mass = 10 + 4*1.0 + 4*0.5 = 16.0 kg

      const connections: RobotConnection[] = [
        createMockConnection("c1", "m-fl", "w-fl"),
        createMockConnection("c2", "m-fr", "w-fr"),
        createMockConnection("c3", "m-rl", "w-rl"),
        createMockConnection("c4", "m-rr", "w-rr"),
      ];

      const drivetrain: DrivetrainConfiguration = {
        type: "differential-4",
        left: [
          { motorId: "m-fl", wheelId: "w-fl" },
          { motorId: "m-rl", wheelId: "w-rl" },
        ],
        right: [
          { motorId: "m-fr", wheelId: "w-fr" },
          { motorId: "m-rr", wheelId: "w-rr" },
        ],
        mappingCustomized: false,
      };

      const stability = compileRobotStabilityProfile(parts, connections, drivetrain);
      expect(stability.validity).toBe("valid");
      expect(stability.centerOfMass.totalMassKg).toBe(16.0);
      expect(stability.wheelLoadDistribution.validity).toBe("valid");
      expect(stability.wheelLoadDistribution.perWheelLoads.filter((w) => w.isDriven)).toHaveLength(4);
      expect(stability.wheelLoadDistribution.drivenLoadFraction).toBeCloseTo(1.0, 5);

      const performance = compileRobotPerformanceProfile(parts, connections, drivetrain, stability);
      expect(performance.totalMassKg).toBe(16.0);
      expect(performance.drivenWheelCount).toBe(4);
      expect(performance.theoreticalPushForceN).toBeGreaterThan(0);
      expect(performance.pushToWeightRatio).toBeGreaterThan(0);

      const inertia = compileRobotInertiaProfile(parts, drivetrain, stability.centerOfMass);
      expect(inertia.validity).toBe("valid");
      expect(inertia.totalMassKg).toBe(16.0);
      expect(inertia.bodyMomentsOfInertia.ixx).toBeGreaterThan(0);
      expect(inertia.bodyMomentsOfInertia.iyy).toBeGreaterThan(0);
      expect(inertia.bodyMomentsOfInertia.izz).toBeGreaterThan(0);
    });
  });
});
