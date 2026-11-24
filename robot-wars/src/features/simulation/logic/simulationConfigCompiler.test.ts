import { describe, expect, it } from "vitest";
import { motorCatalogue } from "../../robot-builder/data/motorCatalogue";
import { batteryCatalogue } from "../../robot-builder/data/batteryCatalogue";
import { wheelCatalogue } from "../../robot-builder/data/wheelCatalogue";
import type {
  ComponentType,
  DrivetrainConfiguration,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../../robot-builder/types/robot.types";
import { compileSimulationConfig } from "./simulationConfigCompiler";

function createPart(
  id: string,
  name: string,
  type: ComponentType,
  massKg: number,
  position: [number, number, number],
  opts?: Partial<RobotPart>
): RobotPart {
  return {
    id,
    name,
    type,
    mass: massKg,
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
  position: [number, number, number],
  opts?: Partial<RobotPart>
): RobotPart {
  return createPart(id, name, "Wheel", massKg, position, {
    wheelCatalogueId: "standard-rubber",
    size: [diameter, axialWidth, diameter],
    geometry: {
      shape: "cylinder",
      diameter,
      axialWidth,
      axis: "x",
    },
    ...opts,
  });
}

function createMotor(
  id: string,
  name: string,
  massKg: number,
  position: [number, number, number],
  stallTorqueNm = 0.8,
  noLoadRpm = 150,
  opts?: Partial<RobotPart>
): RobotPart {
  return createPart(id, name, "Motor", massKg, position, {
    motorCatalogueId: "standard-dc",
    mountingZoneId: `zone-${id}`,
    mechanical: {
      stallTorqueNm,
      noLoadRpm,
    },
    engineeringSpec: {
      category: "motor",
      technology: "brushed-dc",
      mechanical: {
        stallTorqueNm,
        noLoadSpeedRpm: noLoadRpm,
        provenance: {
          method: "datasheet",
          verified: false,
          source: "catalogue:motor:standard-dc",
        },
      },
      mounting: {
        patternType: "face-mount",
      },
    },
    ...opts,
  });
}

function createBattery(
  id: string,
  name: string,
  massKg = 0.22,
  position: [number, number, number] = [0, 0.1, 0],
  nominalVoltageV = 11.1,
  capacityMah = 2200,
  opts?: Partial<RobotPart>
): RobotPart {
  return createPart(id, name, "Battery", massKg, position, {
    batteryCatalogueId: "standard-lipo",
    electrical: {
      nominalVoltageV,
      capacityMah,
    },
    engineeringSpec: {
      category: "battery",
      chemistry: "lipo",
      cellCountS: 3,
      electrical: {
        nominalVoltageV,
        fullyChargedVoltageV: 12.6,
        cutoffVoltageV: 9.0,
        capacityMah,
        provenance: {
          method: "datasheet",
          verified: false,
          source: "catalogue:battery:standard-lipo",
        },
      },
    },
    ...opts,
  });
}

function createBoxChassis(
  id: string,
  name: string,
  length: number,
  height: number,
  width: number,
  massKg: number,
  position: [number, number, number] = [0, 0.1, 0]
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

function createConnection(
  id: string,
  parentId: string,
  childId: string,
  type: "Motor-Wheel" | "Mechanical" = "Motor-Wheel"
): RobotConnection {
  return {
    id,
    type,
    sourceId: parentId,
    targetId: childId,
    parentId,
    childId,
    parentMountPointId: "motor-shaft",
    childMountPointId: "wheel-hub",
    relativePosition: [0, 0, 0],
    relativeRotation: [0, 0, 0],
  };
}

const mockFoundation: FoundationConfig = {
  modelId: "standard-rectangular",
  length: 1.0,
  height: 0.2,
  width: 0.6,
  includeTopPlate: true,
  includeFrontCover: true,
  confirmed: true,
};

describe("simulationConfigCompiler", () => {
  describe("1. Valid 2WD Compilation", () => {
    it("compiles a valid immutable configuration for a 2WD differential drive robot", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 0.8, 0.2, 0.5, 6.0);
      const battery = createBattery("battery-1", "LiPo Battery", 0.5, [0, 0.15, 0]);
      const motorL = createMotor("m-l", "Motor Left", 0.8, [0, 0.1, 0.3], 1.2, 180);
      const motorR = createMotor("m-r", "Motor Right", 0.8, [0, 0.1, -0.3], 1.2, 180);
      const wheelL = createCylinderWheel("w-l", "Wheel Left", 0.22, 0.07, 0.4, [0, 0.11, 0.35]);
      const wheelR = createCylinderWheel("w-r", "Wheel Right", 0.22, 0.07, 0.4, [0, 0.11, -0.35]);

      const parts = [chassis, battery, motorL, motorR, wheelL, wheelR];
      const connections = [
        createConnection("c-chassis-ml", "chassis", "m-l", "Mechanical"),
        createConnection("c-chassis-mr", "chassis", "m-r", "Mechanical"),
        createConnection("c-ml-wl", "m-l", "w-l", "Motor-Wheel"),
        createConnection("c-mr-wr", "m-r", "w-r", "Motor-Wheel"),
      ];

      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m-l", wheelId: "w-l" }],
        right: [{ motorId: "m-r", wheelId: "w-r" }],
        mappingCustomized: false,
      };

      const result = compileSimulationConfig({
        parts,
        connections,
        drivetrain,
        foundation: mockFoundation,
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.config).not.toBeNull();

      const config = result.config!;
      // Total mass = 6.0 + 0.5 + 2 * 0.8 + 2 * 0.4 = 8.9 kg
      expect(config.totalMassKg).toBeCloseTo(8.9, 4);

      // Center of mass and yaw inertia must be finite and positive
      expect(Number.isFinite(config.centerOfMass.x)).toBe(true);
      expect(Number.isFinite(config.centerOfMass.y)).toBe(true);
      expect(Number.isFinite(config.centerOfMass.z)).toBe(true);
      expect(config.yawInertiaKgM2).toBeGreaterThan(0);

      // Track width = |0.35 - (-0.35)| = 0.70 m
      expect(config.trackWidthM).toBeCloseTo(0.70, 4);

      // 2WD has single axle -> wheelbase is null
      expect(config.wheelbaseM).toBeNull();

      // Motors
      expect(config.motors).toHaveLength(2);
      const compiledML = config.motors.find((m) => m.motorId === "m-l");
      expect(compiledML?.side).toBe("left");
      expect(compiledML?.stallTorqueNm).toBe(1.2);
      expect(compiledML?.noLoadRpm).toBe(180);
      expect(compiledML?.noLoadAngularVelocityRadPerSec).toBeCloseTo((180 * 2 * Math.PI) / 60, 4);

      // Wheels
      expect(config.wheels).toHaveLength(2);
      const compiledWL = config.wheels.find((w) => w.wheelId === "w-l");
      expect(compiledWL?.side).toBe("left");
      expect(compiledWL?.diameterM).toBe(0.22);
      expect(compiledWL?.radiusM).toBe(0.11);

      // Battery
      expect(config.battery).not.toBeNull();
      expect(config.battery?.nominalVoltageV).toBe(11.1);

      // Assumptions: must record 2WD passive support and unverified catalogue specs
      expect(config.assumptions.some((a) => a.id === "2wd-passive-support")).toBe(true);
      expect(config.assumptions.some((a) => a.parameter.includes("internalResistanceOhm"))).toBe(true);
    });
  });

  describe("2. Valid 4WD Compilation", () => {
    it("compiles a valid configuration for a 4WD differential drive robot with dual axles", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 12.0);
      const battery = createBattery("battery", "Battery", 0.8, [0, 0.1, 0], 14.8, 4500);

      const mFL = createMotor("m-fl", "M FL", 1.0, [0.3, 0.1, 0.35]);
      const mFR = createMotor("m-fr", "M FR", 1.0, [0.3, 0.1, -0.35]);
      const mRL = createMotor("m-rl", "M RL", 1.0, [-0.3, 0.1, 0.35]);
      const mRR = createMotor("m-rr", "M RR", 1.0, [-0.3, 0.1, -0.35]);

      const wFL = createCylinderWheel("w-fl", "W FL", 0.24, 0.08, 0.6, [0.3, 0.12, 0.4]);
      const wFR = createCylinderWheel("w-fr", "W FR", 0.24, 0.08, 0.6, [0.3, 0.12, -0.4]);
      const wRL = createCylinderWheel("w-rl", "W RL", 0.24, 0.08, 0.6, [-0.3, 0.12, 0.4]);
      const wRR = createCylinderWheel("w-rr", "W RR", 0.24, 0.08, 0.6, [-0.3, 0.12, -0.4]);

      const parts = [chassis, battery, mFL, mFR, mRL, mRR, wFL, wFR, wRL, wRR];
      const connections = [
        createConnection("c-mfl", "chassis", "m-fl", "Mechanical"),
        createConnection("c-mfr", "chassis", "m-fr", "Mechanical"),
        createConnection("c-mrl", "chassis", "m-rl", "Mechanical"),
        createConnection("c-mrr", "chassis", "m-rr", "Mechanical"),
        createConnection("c-wfl", "m-fl", "w-fl", "Motor-Wheel"),
        createConnection("c-wfr", "m-fr", "w-fr", "Motor-Wheel"),
        createConnection("c-wrl", "m-rl", "w-rl", "Motor-Wheel"),
        createConnection("c-wrr", "m-rr", "w-rr", "Motor-Wheel"),
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

      const result = compileSimulationConfig(parts, connections, drivetrain, mockFoundation);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      const config = result.config!;

      // 4WD wheelbase = 0.3 - (-0.3) = 0.60 m
      expect(config.wheelbaseM).toBeCloseTo(0.60, 4);
      // Track width = 0.4 - (-0.4) = 0.80 m
      expect(config.trackWidthM).toBeCloseTo(0.80, 4);
      expect(config.drivetrain.type).toBe("differential-4");
      expect(config.drivetrain.drivenWheelCount).toBe(4);
      expect(config.motors).toHaveLength(4);
      expect(config.wheels).toHaveLength(4);
    });
  });

  describe("3. Invalid Drivetrain & Missing Assignments", () => {
    it("rejects null or missing drivetrain configuration", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0);
      const result = compileSimulationConfig([chassis], [], null);

      expect(result.success).toBe(false);
      expect(result.config).toBeNull();
      expect(result.errors.some((e) => e.includes("No drivetrain configuration"))).toBe(true);
    });

    it("rejects drivetrain with empty left or right side", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0);
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m1", wheelId: "w1" }],
        right: [],
        mappingCustomized: false,
      };

      const result = compileSimulationConfig([chassis], [], drivetrain);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes("both left and right sides"))).toBe(true);
    });

    it("reports error when an assigned motor is missing from assembly", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0);
      const battery = createBattery("battery", "Battery");
      const wheelL = createCylinderWheel("w-l", "W L", 0.2, 0.05, 0.5, [0, 0.1, 0.3]);
      const wheelR = createCylinderWheel("w-r", "W R", 0.2, 0.05, 0.5, [0, 0.1, -0.3]);

      // Notice: motor-ghost is assigned in drivetrain but not in parts
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "motor-ghost", wheelId: "w-l" }],
        right: [{ motorId: "motor-ghost", wheelId: "w-r" }],
        mappingCustomized: false,
      };

      const result = compileSimulationConfig([chassis, battery, wheelL, wheelR], [], drivetrain);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes("was not found in assembly"))).toBe(true);
    });
  });

  describe("4. Missing or Invalid Component Specifications", () => {
    it("rejects motor lacking valid stall torque or no-load RPM", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0);
      const battery = createBattery("battery", "Battery");
      const brokenMotorL = createMotor("m-l", "Broken Motor", 1.0, [0, 0.1, 0.3], 0, 0, {
        mechanical: { stallTorqueNm: 0, noLoadRpm: 0 },
        engineeringSpec: {
          category: "motor",
          technology: "brushed-dc",
          mechanical: { stallTorqueNm: 0, noLoadSpeedRpm: 0 },
        },
      });
      const motorR = createMotor("m-r", "Motor R", 1.0, [0, 0.1, -0.3], 0.8, 150);
      const wheelL = createCylinderWheel("w-l", "W L", 0.2, 0.05, 0.5, [0, 0.1, 0.3]);
      const wheelR = createCylinderWheel("w-r", "W R", 0.2, 0.05, 0.5, [0, 0.1, -0.3]);

      const parts = [chassis, battery, brokenMotorL, motorR, wheelL, wheelR];
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m-l", wheelId: "w-l" }],
        right: [{ motorId: "m-r", wheelId: "w-r" }],
        mappingCustomized: false,
      };

      const result = compileSimulationConfig(parts, [], drivetrain);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes("stall torque"))).toBe(true);
      expect(result.errors.some((e) => e.includes("no-load RPM"))).toBe(true);
    });

    it("rejects wheel lacking valid diameter", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0);
      const battery = createBattery("battery", "Battery");
      const motorL = createMotor("m-l", "M L", 1.0, [0, 0.1, 0.3]);
      const motorR = createMotor("m-r", "M R", 1.0, [0, 0.1, -0.3]);

      // Box geometry used for a wheel (rejected by resolveWheelDimensions)
      const invalidWheel = createPart("w-invalid", "Box Wheel", "Wheel", 0.5, [0, 0.1, 0.3], {
        geometry: { shape: "box", length: 0.2, height: 0.2, width: 0.2 },
        size: [0, 0, 0],
      });
      const wheelR = createCylinderWheel("w-r", "W R", 0.2, 0.05, 0.5, [0, 0.1, -0.3]);

      const parts = [chassis, battery, motorL, motorR, invalidWheel, wheelR];
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m-l", wheelId: "w-invalid" }],
        right: [{ motorId: "m-r", wheelId: "w-r" }],
        mappingCustomized: false,
      };

      const result = compileSimulationConfig(parts, [], drivetrain);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid diameter"))).toBe(true);
    });

    it("rejects assembly lacking any battery power source", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0);
      const motorL = createMotor("m-l", "M L", 1.0, [0, 0.1, 0.3]);
      const motorR = createMotor("m-r", "M R", 1.0, [0, 0.1, -0.3]);
      const wheelL = createCylinderWheel("w-l", "W L", 0.2, 0.05, 0.5, [0, 0.1, 0.3]);
      const wheelR = createCylinderWheel("w-r", "W R", 0.2, 0.05, 0.5, [0, 0.1, -0.3]);

      // No battery in parts array
      const parts = [chassis, motorL, motorR, wheelL, wheelR];
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m-l", wheelId: "w-l" }],
        right: [{ motorId: "m-r", wheelId: "w-r" }],
        mappingCustomized: false,
      };

      const result = compileSimulationConfig(parts, [], drivetrain);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes("No battery installed"))).toBe(true);
    });

    it("rejects assembly with zero total mass", () => {
      const zeroChassis = createPart("c0", "Zero Chassis", "Structural Block", 0, [0, 0, 0], {
        massKg: 0,
      });
      const zeroBattery = createPart("b0", "Zero Battery", "Battery", 0, [0, 0, 0], {
        massKg: 0,
      });
      const zeroMotorL = createMotor("m-l", "M L", 0, [0, 0, 0.3], 0.8, 150, { massKg: 0 });
      const zeroMotorR = createMotor("m-r", "M R", 0, [0, 0, -0.3], 0.8, 150, { massKg: 0 });
      const zeroWheelL = createCylinderWheel("w-l", "W L", 0.2, 0.05, 0, [0, 0, 0.3], { massKg: 0 });
      const zeroWheelR = createCylinderWheel("w-r", "W R", 0.2, 0.05, 0, [0, 0, -0.3], { massKg: 0 });

      const parts = [zeroChassis, zeroBattery, zeroMotorL, zeroMotorR, zeroWheelL, zeroWheelR];
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m-l", wheelId: "w-l" }],
        right: [{ motorId: "m-r", wheelId: "w-r" }],
        mappingCustomized: false,
      };

      const result = compileSimulationConfig(parts, [], drivetrain);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes("non-positive total mass"))).toBe(true);
    });
  });

  describe("5. Immutability & Veracity Protection", () => {
    it("guarantees that compileSimulationConfig does not mutate input parts or drivetrain", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0);
      const battery = createBattery("battery", "Battery");
      const motorL = createMotor("m-l", "M L", 1.0, [0, 0.1, 0.3]);
      const motorR = createMotor("m-r", "M R", 1.0, [0, 0.1, -0.3]);
      const wheelL = createCylinderWheel("w-l", "W L", 0.2, 0.05, 0.5, [0, 0.1, 0.3]);
      const wheelR = createCylinderWheel("w-r", "W R", 0.2, 0.05, 0.5, [0, 0.1, -0.3]);

      const parts = [chassis, battery, motorL, motorR, wheelL, wheelR];
      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m-l", wheelId: "w-l" }],
        right: [{ motorId: "m-r", wheelId: "w-r" }],
        mappingCustomized: false,
      };

      // Take deep snapshot before compilation
      const partsBefore = JSON.stringify(parts);
      const drivetrainBefore = JSON.stringify(drivetrain);

      compileSimulationConfig(parts, [], drivetrain);

      // Verify exact equality after compilation
      expect(JSON.stringify(parts)).toBe(partsBefore);
      expect(JSON.stringify(drivetrain)).toBe(drivetrainBefore);
    });

    it("guarantees catalogue definitions are untouched and unmutated", () => {
      const motorBefore = JSON.stringify(motorCatalogue);
      const batteryBefore = JSON.stringify(batteryCatalogue);
      const wheelBefore = JSON.stringify(wheelCatalogue);

      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0);
      const battery = createBattery("battery", "Battery");
      const motorL = createMotor("m-l", "M L", 1.0, [0, 0.1, 0.3]);
      const motorR = createMotor("m-r", "M R", 1.0, [0, 0.1, -0.3]);
      const wheelL = createCylinderWheel("w-l", "W L", 0.2, 0.05, 0.5, [0, 0.1, 0.3]);
      const wheelR = createCylinderWheel("w-r", "W R", 0.2, 0.05, 0.5, [0, 0.1, -0.3]);

      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m-l", wheelId: "w-l" }],
        right: [{ motorId: "m-r", wheelId: "w-r" }],
        mappingCustomized: false,
      };

      compileSimulationConfig([chassis, battery, motorL, motorR, wheelL, wheelR], [], drivetrain);

      expect(JSON.stringify(motorCatalogue)).toBe(motorBefore);
      expect(JSON.stringify(batteryCatalogue)).toBe(batteryBefore);
      expect(JSON.stringify(wheelCatalogue)).toBe(wheelBefore);
    });

    it("produces no NaN or non-finite values in a valid compiled configuration", () => {
      const chassis = createBoxChassis("chassis", "Chassis", 1.0, 0.2, 0.6, 10.0);
      const battery = createBattery("battery", "Battery");
      const motorL = createMotor("m-l", "M L", 1.0, [0, 0.1, 0.3]);
      const motorR = createMotor("m-r", "M R", 1.0, [0, 0.1, -0.3]);
      const wheelL = createCylinderWheel("w-l", "W L", 0.2, 0.05, 0.5, [0, 0.1, 0.3]);
      const wheelR = createCylinderWheel("w-r", "W R", 0.2, 0.05, 0.5, [0, 0.1, -0.3]);

      const drivetrain: DrivetrainConfiguration = {
        type: "differential-2",
        left: [{ motorId: "m-l", wheelId: "w-l" }],
        right: [{ motorId: "m-r", wheelId: "w-r" }],
        mappingCustomized: false,
      };

      const result = compileSimulationConfig(
        [chassis, battery, motorL, motorR, wheelL, wheelR],
        [],
        drivetrain
      );

      expect(result.success).toBe(true);
      const cfg = result.config!;

      expect(Number.isFinite(cfg.totalMassKg)).toBe(true);
      expect(Number.isFinite(cfg.centerOfMass.x)).toBe(true);
      expect(Number.isFinite(cfg.centerOfMass.y)).toBe(true);
      expect(Number.isFinite(cfg.centerOfMass.z)).toBe(true);
      expect(Number.isFinite(cfg.yawInertiaKgM2)).toBe(true);
      expect(Number.isFinite(cfg.trackWidthM)).toBe(true);
      for (const m of cfg.motors) {
        expect(Number.isFinite(m.stallTorqueNm)).toBe(true);
        expect(Number.isFinite(m.noLoadRpm)).toBe(true);
        expect(Number.isFinite(m.noLoadAngularVelocityRadPerSec)).toBe(true);
      }
      for (const w of cfg.wheels) {
        expect(Number.isFinite(w.diameterM)).toBe(true);
        expect(Number.isFinite(w.radiusM)).toBe(true);
      }
      expect(Number.isFinite(cfg.battery?.nominalVoltageV)).toBe(true);
    });
  });
});
