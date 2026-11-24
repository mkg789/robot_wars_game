import { describe, expect, it } from "vitest";
import {
  calculateDifferentialYawRate,
  calculateInitialAcceleration,
  calculateMotorPushForce,
  calculateTractionLimitedForce,
  calculateWheelLinearSpeed,
  compileRobotPerformanceProfile,
  STANDARD_GRAVITY_MPS2,
} from "./robotKinematics";
import type {
  DrivetrainConfiguration,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";

describe("robotKinematics primitive calculators", () => {
  it("exports exact STANDARD_GRAVITY_MPS2 constant", () => {
    expect(STANDARD_GRAVITY_MPS2).toBeCloseTo(9.80665, 5);
  });
  describe("calculateWheelLinearSpeed", () => {
    it("calculates exact linear speed for standard 180 RPM motor and 0.22 m wheel", () => {
      // omega = 180 * pi / 30 = 6 * pi rad/s ~= 18.8495559 rad/s
      // radius = 0.22 / 2 = 0.11 m
      // v = 6 * pi * 0.11 = 0.66 * pi ~= 2.073451 m/s
      const speed = calculateWheelLinearSpeed(180, 0.22);
      expect(speed).toBeCloseTo(2.07345, 4);
    });

    it("scales linearly with different wheel diameters", () => {
      // Double diameter from 0.20 m to 0.40 m at 150 RPM
      const speedSmall = calculateWheelLinearSpeed(150, 0.2);
      const speedLarge = calculateWheelLinearSpeed(150, 0.4);
      expect(speedLarge).toBeCloseTo(speedSmall * 2, 5);
      // 150 RPM with 0.2m: (150 * pi / 30) * 0.1 = 5 * pi * 0.1 = 0.5 * pi ~= 1.5708 m/s
      expect(speedSmall).toBeCloseTo(1.5708, 4);
    });

    it("scales linearly with different motor RPM", () => {
      // 90 RPM vs 180 RPM with 0.30 m wheel
      const speed90 = calculateWheelLinearSpeed(90, 0.3);
      const speed180 = calculateWheelLinearSpeed(180, 0.3);
      expect(speed180).toBeCloseTo(speed90 * 2, 5);
      // 90 RPM with 0.3m: (90 * pi / 30) * 0.15 = 3 * pi * 0.15 = 0.45 * pi ~= 1.4137 m/s
      expect(speed90).toBeCloseTo(1.4137, 4);
    });

    it("returns 0 for zero or negative RPM or diameter", () => {
      expect(calculateWheelLinearSpeed(0, 0.22)).toBe(0);
      expect(calculateWheelLinearSpeed(180, 0)).toBe(0);
      expect(calculateWheelLinearSpeed(-100, 0.22)).toBe(0);
      expect(calculateWheelLinearSpeed(180, -0.22)).toBe(0);
    });
  });

  describe("calculateMotorPushForce", () => {
    it("translates stall torque to contact patch push force", () => {
      // torque = 0.8 Nm, radius = 0.10 m -> force = 0.8 / 0.10 = 8.0 N
      expect(calculateMotorPushForce(0.8, 0.1)).toBeCloseTo(8.0, 5);
      // torque = 1.6 Nm, radius = 0.08 m -> force = 1.6 / 0.08 = 20.0 N
      expect(calculateMotorPushForce(1.6, 0.08)).toBeCloseTo(20.0, 5);
    });

    it("returns 0 for zero or negative torque or radius", () => {
      expect(calculateMotorPushForce(0, 0.1)).toBe(0);
      expect(calculateMotorPushForce(1.0, 0)).toBe(0);
      expect(calculateMotorPushForce(-1.0, 0.1)).toBe(0);
      expect(calculateMotorPushForce(1.0, -0.1)).toBe(0);
    });
  });

  describe("calculateTractionLimitedForce", () => {
    it("computes Coulomb static friction limit", () => {
      // mu_s = 0.85, normal force = 100 N -> 85 N
      expect(calculateTractionLimitedForce(0.85, 100)).toBeCloseTo(85.0, 5);
      // mu_s = 0.70, normal force = 50 N -> 35 N
      expect(calculateTractionLimitedForce(0.7, 50)).toBeCloseTo(35.0, 5);
    });

    it("returns 0 for non-positive friction or normal force", () => {
      expect(calculateTractionLimitedForce(0, 100)).toBe(0);
      expect(calculateTractionLimitedForce(0.85, 0)).toBe(0);
      expect(calculateTractionLimitedForce(-0.5, 100)).toBe(0);
      expect(calculateTractionLimitedForce(0.85, -50)).toBe(0);
    });
  });

  describe("calculateInitialAcceleration", () => {
    it("computes acceleration via F / m", () => {
      // F = 20 N, m = 4 kg -> a = 5.0 m/s²
      expect(calculateInitialAcceleration(20, 4)).toBeCloseTo(5.0, 5);
    });

    it("returns 0 for non-positive force or mass", () => {
      expect(calculateInitialAcceleration(0, 5)).toBe(0);
      expect(calculateInitialAcceleration(20, 0)).toBe(0);
      expect(calculateInitialAcceleration(-10, 5)).toBe(0);
      expect(calculateInitialAcceleration(20, -5)).toBe(0);
    });
  });

  describe("calculateDifferentialYawRate", () => {
    it("computes spin-turn yaw rate: (2 * v) / trackWidth", () => {
      // v = 2.0 m/s, track = 0.8 m -> yaw = 4.0 / 0.8 = 5.0 rad/s
      expect(calculateDifferentialYawRate(2.0, 0.8)).toBeCloseTo(5.0, 5);
    });

    it("returns 0 for non-positive speed or track width", () => {
      expect(calculateDifferentialYawRate(0, 1.0)).toBe(0);
      expect(calculateDifferentialYawRate(2.0, 0)).toBe(0);
      expect(calculateDifferentialYawRate(-2.0, 1.0)).toBe(0);
      expect(calculateDifferentialYawRate(2.0, -1.0)).toBe(0);
    });
  });
});

describe("compileRobotPerformanceProfile assembly compiler", () => {
  // Helper to create mock parts
  const createMockMotor = (
    id: string,
    stallTorqueNm: number,
    noLoadRpm: number,
    position: [number, number, number] = [0, 0, 0]
  ): RobotPart => ({
    id,
    name: `Motor ${id}`,
    type: "Motor",
    position,
    rotation: [0, 0, 0],
    size: [0.38, 0.34, 0.42],
    color: "#ef4444",
    mass: 0.5,
    massKg: 0.5,
    mechanical: { stallTorqueNm, noLoadRpm },
    engineeringSpec: {
      category: "motor",
      technology: "brushed-dc",
      mechanical: { stallTorqueNm, noLoadSpeedRpm: noLoadRpm },
    },
  });

  const createMockWheel = (
    id: string,
    diameterM: number,
    position: [number, number, number],
    staticFrictionCoeff = 0.85
  ): RobotPart => ({
    id,
    name: `Wheel ${id}`,
    type: "Wheel",
    position,
    rotation: [0, 0, 0],
    size: [diameterM, 0.07, diameterM],
    color: "#171b22",
    mass: 0.3,
    massKg: 0.3,
    wheelDiameter: diameterM,
    wheelWidth: 0.07,
    geometry: {
      shape: "cylinder",
      diameter: diameterM,
      axialWidth: 0.07,
      axis: "x",
    },
    engineeringSpec: {
      category: "wheel",
      treadType: "rubber",
      traction: { staticFrictionCoeff },
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
    parentMountPointId: "motor-shaft",
    childMountPointId: "wheel-hub",
    relativePosition: [0, 0, 0],
    relativeRotation: [0, 0, 0],
  });

  const createMockChassis = (massKg = 2.0): RobotPart => ({
    id: "foundation-chassis",
    name: "Chassis",
    type: "Structural Block",
    position: [0, 0.2, 0],
    rotation: [0, 0, 0],
    size: [2.0, 0.35, 1.4],
    color: "#334155",
    mass: massKg,
    massKg,
    engineeringSpec: {
      category: "structural",
      role: "chassis-frame",
    },
  });

  it("evaluates a standard 2WD differential drive robot with torque-limited push force", () => {
    // 2WD robot:
    // 2 x Standard DC motors (stall: 0.8 Nm, no-load: 150 RPM)
    // 2 x Wheels: 22 cm diameter (r = 0.11 m)
    // Left wheel position: [0, 0.11, 0.6]
    // Right wheel position: [0, 0.11, -0.6]
    // Chassis: 3.4 kg. Total mass = 3.4 + 2*(0.5 motor) + 2*(0.3 wheel) = 5.0 kg
    const motorL = createMockMotor("motor-l", 0.8, 150, [0, 0.11, 0.5]);
    const motorR = createMockMotor("motor-r", 0.8, 150, [0, 0.11, -0.5]);
    const wheelL = createMockWheel("wheel-l", 0.22, [0, 0.11, 0.6]);
    const wheelR = createMockWheel("wheel-r", 0.22, [0, 0.11, -0.6]);
    const chassis = createMockChassis(3.4);

    const parts = [chassis, motorL, motorR, wheelL, wheelR];
    const connections: RobotConnection[] = [
      createMockConnection("c1", "motor-l", "wheel-l"),
      createMockConnection("c2", "motor-r", "wheel-r"),
    ];
    const drivetrain: DrivetrainConfiguration = {
      type: "differential-2",
      left: [{ motorId: "motor-l", wheelId: "wheel-l" }],
      right: [{ motorId: "motor-r", wheelId: "wheel-r" }],
      mappingCustomized: false,
    };

    const profile = compileRobotPerformanceProfile(parts, connections, drivetrain);

    // Total mass: 3.4 + 1.0 + 0.6 = 5.0 kg
    expect(profile.totalMassKg).toBeCloseTo(5.0, 4);
    expect(profile.drivenWheelCount).toBe(2);

    // Speed: 150 RPM, 0.22 m diameter
    // v = (150 * pi / 30) * 0.11 = 5 * pi * 0.11 = 0.55 * pi ~= 1.727876 m/s
    expect(profile.topSpeedMps).toBeCloseTo(1.7279, 3);
    // km/h = 1.727876 * 3.6 ~= 6.22035 km/h
    expect(profile.topSpeedKmh).toBeCloseTo(6.22, 2);

    // Motor Push Force: 2 motors * (0.8 / 0.11) = 2 * 7.2727 = 14.5454 N
    expect(profile.motorLimitedPushForceN).toBeCloseTo(14.545, 2);

    // Traction Limit: 2WD assumes 60% mass on driven wheels
    // drivenMass = 5.0 * 0.60 = 3.0 kg
    // Normal force = 3.0 * 9.80665 = 29.41995 N
    // Traction limit = 0.85 * 29.41995 = 25.0069 N
    expect(profile.tractionLimitedPushForceN).toBeCloseTo(25.007, 2);

    // Effective force: min(14.545, 25.007) = 14.545 N (Torque-limited)
    expect(profile.theoreticalPushForceN).toBeCloseTo(14.545, 2);
    expect(profile.pushForceLimiter).toBe("motor-torque");

    // Initial Acceleration: a = 14.5454 / 5.0 = 2.909 m/s²
    expect(profile.maxAccelerationMps2).toBeCloseTo(2.909, 2);
    // Acceleration in g: 2.90909 / 9.80665 ~= 0.2966 g
    expect(profile.maxAccelerationG).toBeCloseTo(0.297, 2);
    expect(profile.pushToWeightRatio).toBeCloseTo(0.297, 2);

    // Track width: leftZ = 0.6, rightZ = -0.6 -> |0.6 - (-0.6)| = 1.2 m
    expect(profile.trackWidthM).toBeCloseTo(1.2, 3);
    // Single axle row -> wheelbase = 0
    expect(profile.wheelbaseM).toBe(0);

    // Yaw rate: (2 * v) / track = (2 * 1.727876) / 1.2 = 3.45575 / 1.2 ~= 2.8798 rad/s
    expect(profile.maxYawRateRadPerSec).toBeCloseTo(2.88, 2);
    // In deg/s: 2.8798 * 180 / pi ~= 165.0 deg/s
    expect(profile.maxYawRateDegPerSec).toBeCloseTo(165.0, 1);

    expect(profile.assumptions.length).toBeGreaterThan(0);
  });

  it("evaluates a 4WD differential drive robot with traction-limited push force", () => {
    // 4WD robot with 4 x High-Torque DC motors (1.6 Nm stall, 90 RPM)
    // 4 x Wheels: 20 cm diameter (r = 0.10 m)
    // Total Mass: 4.0 kg (lightweight robot with massive torque)
    const motorFL = createMockMotor("m-fl", 1.6, 90, [0.4, 0.1, 0.4]);
    const motorFR = createMockMotor("m-fr", 1.6, 90, [0.4, 0.1, -0.4]);
    const motorRL = createMockMotor("m-rl", 1.6, 90, [-0.4, 0.1, 0.4]);
    const motorRR = createMockMotor("m-rr", 1.6, 90, [-0.4, 0.1, -0.4]);

    const wheelFL = createMockWheel("w-fl", 0.2, [0.4, 0.1, 0.5], 0.8);
    const wheelFR = createMockWheel("w-fr", 0.2, [0.4, 0.1, -0.5], 0.8);
    const wheelRL = createMockWheel("w-rl", 0.2, [-0.4, 0.1, 0.5], 0.8);
    const wheelRR = createMockWheel("w-rr", 0.2, [-0.4, 0.1, -0.5], 0.8);

    const chassis = createMockChassis(0.8); // 0.8 + 4*0.5 + 4*0.3 = 4.0 kg

    const parts = [chassis, motorFL, motorFR, motorRL, motorRR, wheelFL, wheelFR, wheelRL, wheelRR];
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

    const profile = compileRobotPerformanceProfile(parts, connections, drivetrain);

    expect(profile.totalMassKg).toBeCloseTo(4.0, 4);
    expect(profile.drivenWheelCount).toBe(4);

    // Motor Push Force: 4 * (1.6 / 0.10) = 4 * 16.0 = 64.0 N
    expect(profile.motorLimitedPushForceN).toBeCloseTo(64.0, 2);

    // 4WD Traction Limit: 100% of mass on driven wheels
    // N = 4.0 * 9.80665 = 39.2266 N
    // F_traction = 0.80 * 39.2266 = 31.3813 N
    expect(profile.tractionLimitedPushForceN).toBeCloseTo(31.381, 2);

    // Effective force is limited by tire traction!
    expect(profile.theoreticalPushForceN).toBeCloseTo(31.381, 2);
    expect(profile.pushForceLimiter).toBe("tire-traction");

    // Acceleration: a = 31.3813 / 4.0 = 7.845 m/s²
    expect(profile.maxAccelerationMps2).toBeCloseTo(7.845, 2);
    // a in g: 7.8453 / 9.80665 = 0.80 g (matches friction coefficient!)
    expect(profile.maxAccelerationG).toBeCloseTo(0.8, 2);
    expect(profile.pushToWeightRatio).toBeCloseTo(0.8, 2);

    // Wheelbase: x coords are 0.4 and -0.4 -> delta = 0.8 m
    expect(profile.wheelbaseM).toBeCloseTo(0.8, 3);
    // Track width: leftZ = 0.5, rightZ = -0.5 -> delta = 1.0 m
    expect(profile.trackWidthM).toBeCloseTo(1.0, 3);

    // Top Speed: 90 RPM, 0.20 m diameter
    // v = (90 * pi / 30) * 0.10 = 3 * pi * 0.10 ~= 0.942478 m/s
    expect(profile.topSpeedMps).toBeCloseTo(0.9425, 3);
    expect(profile.topSpeedKmh).toBeCloseTo(3.39, 2);

    // Yaw rate: (2 * 0.942478) / 1.0 ~= 1.885 rad/s
    expect(profile.maxYawRateRadPerSec).toBeCloseTo(1.885, 3);
    // 4WD assumption warning
    expect(
      profile.assumptions.some((a) => a.includes("longitudinal wheel scrub"))
    ).toBe(true);
  });

  describe("Edge cases and missing-data resilience", () => {
    it("handles null or empty drivetrain gracefully", () => {
      const chassis = createMockChassis(3.0);
      const profile = compileRobotPerformanceProfile([chassis], [], null);

      expect(profile.totalMassKg).toBe(3.0);
      expect(profile.drivenWheelCount).toBe(0);
      expect(profile.topSpeedMps).toBeUndefined();
      expect(profile.theoreticalPushForceN).toBeUndefined();
      expect(profile.maxAccelerationMps2).toBeUndefined();
      expect(profile.trackWidthM).toBeUndefined();
      expect(profile.wheelbaseM).toBeUndefined();
      expect(profile.assumptions).toContain("No powered wheel assemblies assigned to drivetrain.");
    });

    it("handles zero total mass without division-by-zero errors", () => {
      const motorL = createMockMotor("m1", 0.8, 150);
      const motorR = createMockMotor("m2", 0.8, 150);
      const wheelL = createMockWheel("w1", 0.22, [0, 0, 0.5]);
      const wheelR = createMockWheel("w2", 0.22, [0, 0, -0.5]);

      // Strip mass to 0
      const zeroParts = [motorL, motorR, wheelL, wheelR].map((p) => ({
        ...p,
        mass: 0,
        massKg: 0,
      }));

      const connections: RobotConnection[] = [
        createMockConnection("c1", "m1", "w1"),
        createMockConnection("c2", "m2", "w2"),
      ];
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m1", wheelId: "w1" }],
        right: [{ motorId: "m2", wheelId: "w2" }],
        mappingCustomized: false,
      };

      const profile = compileRobotPerformanceProfile(zeroParts, connections, drivetrain);
      expect(profile.totalMassKg).toBe(0);
      expect(profile.maxAccelerationMps2).toBeUndefined();
      expect(profile.pushToWeightRatio).toBeUndefined();
    });

    it("handles motor without mechanical specs gracefully", () => {
      const motorNoSpecs: RobotPart = {
        ...createMockMotor("m1", 0, 0),
        mechanical: undefined,
        engineeringSpec: undefined,
      };
      const motorR = createMockMotor("m2", 0.8, 150, [0, 0, -0.5]);
      const wheelL = createMockWheel("w1", 0.22, [0, 0, 0.5]);
      const wheelR = createMockWheel("w2", 0.22, [0, 0, -0.5]);

      const parts = [motorNoSpecs, motorR, wheelL, wheelR];
      const connections: RobotConnection[] = [
        createMockConnection("c1", "m1", "w1"),
        createMockConnection("c2", "m2", "w2"),
      ];
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m1", wheelId: "w1" }],
        right: [{ motorId: "m2", wheelId: "w2" }],
        mappingCustomized: false,
      };

      const profile = compileRobotPerformanceProfile(parts, connections, drivetrain);
      // Because one motor lacks verified specs, topSpeedMps cannot be fully guaranteed
      expect(profile.topSpeedMps).toBeUndefined();
      expect(profile.assumptions.some((a) => a.includes("lack verified RPM"))).toBe(true);
    });

    it("handles missing wheel-to-motor connection without crashing", () => {
      const motor = createMockMotor("m1", 0.8, 150);
      const wheel = createMockWheel("w1", 0.22, [0, 0, 0.5]);

      // Drivetrain claims an assignment, but no connection exists
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m1", wheelId: "w1" }],
        right: [null],
        mappingCustomized: false,
      };

      const profile = compileRobotPerformanceProfile([motor, wheel], [], drivetrain);
      expect(profile.drivenWheelCount).toBe(0);
      expect(profile.assumptions).toContain(
        "Assigned drivetrain assemblies do not have valid motor-wheel attachments."
      );
    });
  });
});
