import { describe, expect, it } from "vitest";
import {
  calculateMotorTorque,
  calculateWheelTractionLimit,
  createInitialSimulationState,
  normalizeAngle,
  stepDrivetrainDynamics,
} from "./drivetrainDynamics";
import type {
  DrivetrainInput,
  SimulationRobotConfig,
} from "../types/simulation.types";

function createMock2WDRobotConfig(
  overrides?: Partial<SimulationRobotConfig>
): SimulationRobotConfig {
  const stallTorqueNm = 1.5;
  const noLoadRpm = 300;
  const noLoadAngularVelocityRadPerSec = (noLoadRpm * 2 * Math.PI) / 60; // ~31.4159 rad/s
  const diameterM = 0.2;
  const radiusM = 0.1;
  const totalMassKg = 10.0;
  const normalPerWheelN = (totalMassKg * 9.80665) / 2; // 49.03325 N

  return {
    totalMassKg,
    centerOfMass: { x: 0, y: 0.1, z: 0 },
    yawInertiaKgM2: 0.5,
    trackWidthM: 0.6,
    wheelbaseM: null,
    drivetrain: {
      type: "differential-2",
      drivenWheelCount: 2,
      leftSlotCount: 1,
      rightSlotCount: 1,
    },
    motors: [
      {
        motorId: "motor-l",
        name: "Left Motor",
        side: "left",
        slotIndex: 0,
        stallTorqueNm,
        noLoadRpm,
        noLoadAngularVelocityRadPerSec,
        provenance: { source: "catalogue:motor:test", verified: true },
      },
      {
        motorId: "motor-r",
        name: "Right Motor",
        side: "right",
        slotIndex: 0,
        stallTorqueNm,
        noLoadRpm,
        noLoadAngularVelocityRadPerSec,
        provenance: { source: "catalogue:motor:test", verified: true },
      },
    ],
    wheels: [
      {
        wheelId: "wheel-l",
        name: "Left Wheel",
        side: "left",
        slotIndex: 0,
        diameterM,
        radiusM,
        staticFrictionCoeff: 0.85,
        normalLoadN: normalPerWheelN,
        provenance: { source: "canonical-cylinder", verified: true },
      },
      {
        wheelId: "wheel-r",
        name: "Right Wheel",
        side: "right",
        slotIndex: 0,
        diameterM,
        radiusM,
        staticFrictionCoeff: 0.85,
        normalLoadN: normalPerWheelN,
        provenance: { source: "canonical-cylinder", verified: true },
      },
    ],
    battery: {
      batteryId: "bat-1",
      name: "3S LiPo",
      nominalVoltageV: 11.1,
      provenance: { source: "catalogue:battery:test", verified: true },
    },
    normalLoads: {
      totalNormalForceN: totalMassKg * 9.80665,
      leftSideNormalForceN: normalPerWheelN,
      rightSideNormalForceN: normalPerWheelN,
      perWheelLoads: [
        { wheelId: "wheel-l", normalForceN: normalPerWheelN, isDriven: true },
        { wheelId: "wheel-r", normalForceN: normalPerWheelN, isDriven: true },
      ],
    },
    assumptions: [],
    validity: "valid",
    warnings: [],
    ...overrides,
  };
}

function createMock4WDRobotConfig(): SimulationRobotConfig {
  const stallTorqueNm = 1.0;
  const noLoadRpm = 200;
  const noLoadAngularVelocityRadPerSec = (noLoadRpm * 2 * Math.PI) / 60;
  const radiusM = 0.08;
  const totalMassKg = 16.0;
  const normalPerWheelN = (totalMassKg * 9.80665) / 4; // 39.2266 N

  return {
    totalMassKg,
    centerOfMass: { x: 0, y: 0.1, z: 0 },
    yawInertiaKgM2: 1.2,
    trackWidthM: 0.5,
    wheelbaseM: 0.4,
    drivetrain: {
      type: "differential-4",
      drivenWheelCount: 4,
      leftSlotCount: 2,
      rightSlotCount: 2,
    },
    motors: [
      {
        motorId: "m-fl",
        name: "M FL",
        side: "left",
        slotIndex: 0,
        stallTorqueNm,
        noLoadRpm,
        noLoadAngularVelocityRadPerSec,
        provenance: { source: "cat", verified: true },
      },
      {
        motorId: "m-rl",
        name: "M RL",
        side: "left",
        slotIndex: 1,
        stallTorqueNm,
        noLoadRpm,
        noLoadAngularVelocityRadPerSec,
        provenance: { source: "cat", verified: true },
      },
      {
        motorId: "m-fr",
        name: "M FR",
        side: "right",
        slotIndex: 0,
        stallTorqueNm,
        noLoadRpm,
        noLoadAngularVelocityRadPerSec,
        provenance: { source: "cat", verified: true },
      },
      {
        motorId: "m-rr",
        name: "M RR",
        side: "right",
        slotIndex: 1,
        stallTorqueNm,
        noLoadRpm,
        noLoadAngularVelocityRadPerSec,
        provenance: { source: "cat", verified: true },
      },
    ],
    wheels: [
      {
        wheelId: "w-fl",
        name: "W FL",
        side: "left",
        slotIndex: 0,
        diameterM: radiusM * 2,
        radiusM,
        staticFrictionCoeff: 0.9,
        normalLoadN: normalPerWheelN,
        provenance: { source: "cyl", verified: true },
      },
      {
        wheelId: "w-rl",
        name: "W RL",
        side: "left",
        slotIndex: 1,
        diameterM: radiusM * 2,
        radiusM,
        staticFrictionCoeff: 0.9,
        normalLoadN: normalPerWheelN,
        provenance: { source: "cyl", verified: true },
      },
      {
        wheelId: "w-fr",
        name: "W FR",
        side: "right",
        slotIndex: 0,
        diameterM: radiusM * 2,
        radiusM,
        staticFrictionCoeff: 0.9,
        normalLoadN: normalPerWheelN,
        provenance: { source: "cyl", verified: true },
      },
      {
        wheelId: "w-rr",
        name: "W RR",
        side: "right",
        slotIndex: 1,
        diameterM: radiusM * 2,
        radiusM,
        staticFrictionCoeff: 0.9,
        normalLoadN: normalPerWheelN,
        provenance: { source: "cyl", verified: true },
      },
    ],
    battery: null,
    normalLoads: null,
    assumptions: [],
    validity: "valid",
    warnings: [],
  };
}

describe("drivetrainDynamics", () => {
  describe("1. Motor Model", () => {
    const stallTorqueNm = 2.0;
    const noLoadOmega = 100.0; // rad/s

    it("calculates full stall torque at zero angular velocity under full throttle", () => {
      const res = calculateMotorTorque(stallTorqueNm, noLoadOmega, 1.0, 0);
      expect(res.torqueNm).toBeCloseTo(2.0, 5);
      expect(res.isOverspeed).toBe(false);
      expect(res.isPlugging).toBe(false);
    });

    it("calculates zero torque at no-load angular velocity under full throttle", () => {
      const res = calculateMotorTorque(stallTorqueNm, noLoadOmega, 1.0, noLoadOmega);
      expect(res.torqueNm).toBeCloseTo(0.0, 5);
      expect(res.isOverspeed).toBe(true);
    });

    it("follows a linear torque-speed slope at intermediate speeds", () => {
      // At half speed (50 rad/s), torque should be exactly 50% of stall torque (1.0 N·m)
      const resHalf = calculateMotorTorque(stallTorqueNm, noLoadOmega, 1.0, 50.0);
      expect(resHalf.torqueNm).toBeCloseTo(1.0, 5);

      // At quarter speed (25 rad/s), torque should be 75% of stall torque (1.5 N·m)
      const resQuarter = calculateMotorTorque(stallTorqueNm, noLoadOmega, 1.0, 25.0);
      expect(resQuarter.torqueNm).toBeCloseTo(1.5, 5);
    });

    it("handles reverse motor operation correctly and symmetrically", () => {
      // Reverse stall
      const resRevStall = calculateMotorTorque(stallTorqueNm, noLoadOmega, -1.0, 0);
      expect(resRevStall.torqueNm).toBeCloseTo(-2.0, 5);
      expect(resRevStall.isPlugging).toBe(false);

      // Reverse no-load
      const resRevNoLoad = calculateMotorTorque(stallTorqueNm, noLoadOmega, -1.0, -noLoadOmega);
      expect(resRevNoLoad.torqueNm).toBeCloseTo(0.0, 5);
      expect(resRevNoLoad.isOverspeed).toBe(true);

      // Reverse half speed
      const resRevHalf = calculateMotorTorque(stallTorqueNm, noLoadOmega, -1.0, -50.0);
      expect(resRevHalf.torqueNm).toBeCloseTo(-1.0, 5);
    });

    it("handles overspeed behavior consistently without wrong torque signs", () => {
      // Forward overspeed: spinning faster than commanded no-load speed
      const resForwardOverspeed = calculateMotorTorque(stallTorqueNm, noLoadOmega, 1.0, 120.0);
      expect(resForwardOverspeed.torqueNm).toBe(0);
      expect(resForwardOverspeed.isOverspeed).toBe(true);

      // Reverse overspeed: spinning faster in reverse than commanded reverse no-load speed
      const resRevOverspeed = calculateMotorTorque(stallTorqueNm, noLoadOmega, -1.0, -120.0);
      expect(resRevOverspeed.torqueNm).toBe(0);
      expect(resRevOverspeed.isOverspeed).toBe(true);
    });

    it("handles counter-rotation (plugging) clamped at stall torque magnitude", () => {
      // Forward throttle while moving backward
      const resPluggingFwd = calculateMotorTorque(stallTorqueNm, noLoadOmega, 1.0, -50.0);
      expect(resPluggingFwd.torqueNm).toBeCloseTo(2.0, 5); // clamped to stallTorque
      expect(resPluggingFwd.isPlugging).toBe(true);

      // Reverse throttle while moving forward
      const resPluggingRev = calculateMotorTorque(stallTorqueNm, noLoadOmega, -1.0, 50.0);
      expect(resPluggingRev.torqueNm).toBeCloseTo(-2.0, 5); // clamped to -stallTorque
      expect(resPluggingRev.isPlugging).toBe(true);
    });

    it("produces zero torque when throttle is zero (neutral coast)", () => {
      const resNeutralZero = calculateMotorTorque(stallTorqueNm, noLoadOmega, 0, 0);
      expect(resNeutralZero.torqueNm).toBe(0);

      const resNeutralSpinning = calculateMotorTorque(stallTorqueNm, noLoadOmega, 0, 50);
      expect(resNeutralSpinning.torqueNm).toBe(0);
    });
  });

  describe("2. Wheel Dynamics & Traction", () => {
    it("converts motor torque to ground force via wheel radius F = τ / r", () => {
      const torque = 1.5; // N·m
      const radius = 0.1; // m
      const expectedForce = torque / radius; // 15 N
      expect(expectedForce).toBeCloseTo(15.0, 5);
    });

    it("shows smaller wheel radius increases available rim push force", () => {
      const torque = 1.2;
      const largeRadius = 0.12;
      const smallRadius = 0.06;

      const fLarge = torque / largeRadius; // 10 N
      const fSmall = torque / smallRadius; // 20 N

      expect(fSmall).toBeGreaterThan(fLarge);
      expect(fSmall).toBeCloseTo(2 * fLarge, 5);
    });

    it("calculates traction limit μ * F_normal", () => {
      const mu = 0.85;
      const fNormal = 50.0;
      const limit = calculateWheelTractionLimit(mu, fNormal);
      expect(limit).toBeCloseTo(42.5, 5);
    });

    it("saturates ground force when drive force exceeds traction limit", () => {
      // Setup robot with low normal load or low friction to induce traction saturation
      const lowMuConfig = createMock2WDRobotConfig({
        wheels: [
          {
            wheelId: "wheel-l",
            name: "Left Wheel",
            side: "left",
            slotIndex: 0,
            diameterM: 0.2,
            radiusM: 0.1,
            staticFrictionCoeff: 0.1, // low friction
            normalLoadN: 20.0, // traction limit = 0.1 * 20 = 2.0 N
            provenance: { source: "test", verified: true },
          },
          {
            wheelId: "wheel-r",
            name: "Right Wheel",
            side: "right",
            slotIndex: 0,
            diameterM: 0.2,
            radiusM: 0.1,
            staticFrictionCoeff: 0.1,
            normalLoadN: 20.0,
            provenance: { source: "test", verified: true },
          },
        ],
      });

      // Motor stall torque 1.5 N·m / 0.1 m = 15.0 N theoretical force, but traction limit is 2.0 N
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };
      const { state: nextState, diagnostics } = stepDrivetrainDynamics(
        lowMuConfig,
        state,
        input,
        0.02
      );

      expect(diagnostics.isTractionLimited).toBe(true);
      expect(diagnostics.leftDriveForceN).toBeCloseTo(2.0, 4);
      expect(diagnostics.rightDriveForceN).toBeCloseTo(2.0, 4);
      expect(diagnostics.netLongitudinalForceN).toBeCloseTo(4.0, 4);
      expect(nextState.longitudinalAccelerationMps2).toBeCloseTo(4.0 / lowMuConfig.totalMassKg, 4);
    });

    it("handles reverse traction limits consistently", () => {
      const lowMuConfig = createMock2WDRobotConfig({
        wheels: [
          {
            wheelId: "wheel-l",
            name: "Left Wheel",
            side: "left",
            slotIndex: 0,
            diameterM: 0.2,
            radiusM: 0.1,
            staticFrictionCoeff: 0.2,
            normalLoadN: 25.0, // limit = 5.0 N
            provenance: { source: "test", verified: true },
          },
          {
            wheelId: "wheel-r",
            name: "Right Wheel",
            side: "right",
            slotIndex: 0,
            diameterM: 0.2,
            radiusM: 0.1,
            staticFrictionCoeff: 0.2,
            normalLoadN: 25.0,
            provenance: { source: "test", verified: true },
          },
        ],
      });

      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: -1.0, rightThrottle: -1.0 };
      const { diagnostics } = stepDrivetrainDynamics(lowMuConfig, state, input, 0.02);

      expect(diagnostics.isTractionLimited).toBe(true);
      expect(diagnostics.leftDriveForceN).toBeCloseTo(-5.0, 4);
      expect(diagnostics.rightDriveForceN).toBeCloseTo(-5.0, 4);
      expect(diagnostics.netLongitudinalForceN).toBeCloseTo(-10.0, 4);
    });
  });

  describe("3. Robot Movement & Dynamics", () => {
    it("accelerates forward along +X with symmetric positive throttle", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };
      const dt = 0.05;

      const { state: nextState, diagnostics } = stepDrivetrainDynamics(config, state, input, dt);

      // Motor torque = 1.5 N·m, radius = 0.1 m -> F_drive = 15 N per wheel
      // Traction limit = 0.85 * 49.033 N = 41.67 N > 15 N (not saturated)
      expect(diagnostics.isTractionLimited).toBe(false);
      expect(diagnostics.leftDriveForceN).toBeCloseTo(15.0, 3);
      expect(diagnostics.rightDriveForceN).toBeCloseTo(15.0, 3);
      expect(diagnostics.netLongitudinalForceN).toBeCloseTo(30.0, 3);

      // a_x = 30 N / 10 kg = 3.0 m/s²
      expect(nextState.longitudinalAccelerationMps2).toBeCloseTo(3.0, 4);

      // v_x = 0 + 3.0 * 0.05 = 0.15 m/s
      expect(nextState.longitudinalVelocityMps).toBeCloseTo(0.15, 4);

      // Position update: x = 0 + 0.15 * cos(0) * 0.05 = 0.0075 m, z = 0
      expect(nextState.xMeters).toBeCloseTo(0.0075, 5);
      expect(nextState.zMeters).toBeCloseTo(0, 5);
      expect(nextState.headingRadians).toBeCloseTo(0, 5);
      expect(nextState.yawRateRadPerSec).toBeCloseTo(0, 5);
    });

    it("accelerates backward along -X with symmetric negative throttle", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: -1.0, rightThrottle: -1.0 };
      const dt = 0.05;

      const { state: nextState, diagnostics } = stepDrivetrainDynamics(config, state, input, dt);

      expect(diagnostics.leftDriveForceN).toBeCloseTo(-15.0, 3);
      expect(diagnostics.rightDriveForceN).toBeCloseTo(-15.0, 3);
      expect(diagnostics.netLongitudinalForceN).toBeCloseTo(-30.0, 3);
      expect(nextState.longitudinalAccelerationMps2).toBeCloseTo(-3.0, 4);
      expect(nextState.longitudinalVelocityMps).toBeCloseTo(-0.15, 4);
      expect(nextState.xMeters).toBeCloseTo(-0.0075, 5);
      expect(nextState.zMeters).toBeCloseTo(0, 5);
    });

    it("maintains zero motion when throttle is zero from rest (no artificial drift)", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 0, rightThrottle: 0 };

      const { state: nextState, diagnostics } = stepDrivetrainDynamics(config, state, input, 0.1);

      expect(diagnostics.leftDriveForceN).toBe(0);
      expect(diagnostics.rightDriveForceN).toBe(0);
      expect(diagnostics.netLongitudinalForceN).toBe(0);
      expect(diagnostics.netYawTorqueNm).toBe(0);
      expect(nextState.longitudinalVelocityMps).toBe(0);
      expect(nextState.yawRateRadPerSec).toBe(0);
      expect(nextState.xMeters).toBe(0);
      expect(nextState.zMeters).toBe(0);
      expect(nextState.headingRadians).toBe(0);
    });

    it("produces straight motion without yawing when left and right forces are identical", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 0.75, rightThrottle: 0.75 };

      const { state: nextState, diagnostics } = stepDrivetrainDynamics(config, state, input, 0.05);

      expect(diagnostics.netYawTorqueNm).toBeCloseTo(0, 6);
      expect(nextState.angularAccelerationRadPerSec2).toBeCloseTo(0, 6);
      expect(nextState.yawRateRadPerSec).toBeCloseTo(0, 6);
      expect(nextState.headingRadians).toBeCloseTo(0, 6);
      expect(nextState.zMeters).toBeCloseTo(0, 6);
    });

    it("produces positive yaw torque (counter-clockwise / left turn) when right force > left force", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();
      // Right motor pushing forward, left motor neutral
      const input: DrivetrainInput = { leftThrottle: 0, rightThrottle: 1.0 };
      const dt = 0.05;

      const { state: nextState, diagnostics } = stepDrivetrainDynamics(config, state, input, dt);

      // F_L = 0, F_R = 15 N
      // τ_yaw = (w/2) * (F_R - F_L) = (0.6 / 2) * 15 = 4.5 N·m > 0
      expect(diagnostics.netYawTorqueNm).toBeCloseTo(4.5, 4);

      // α_yaw = τ / I_yaw = 4.5 / 0.5 = 9.0 rad/s²
      expect(nextState.angularAccelerationRadPerSec2).toBeCloseTo(9.0, 4);

      // ω_yaw = 0 + 9.0 * 0.05 = 0.45 rad/s > 0 (turning left)
      expect(nextState.yawRateRadPerSec).toBeCloseTo(0.45, 4);

      // Heading θ = 0 + 0.45 * 0.05 = 0.0225 rad
      expect(nextState.headingRadians).toBeCloseTo(0.0225, 4);

      // Forward velocity: a_x = 15 / 10 = 1.5 m/s² -> v_x = 0.075 m/s
      // Z movement: z = 0.075 * sin(0.0225) * 0.05 > 0 (moving toward +Z, which is left)
      expect(nextState.zMeters).toBeGreaterThan(0);
    });

    it("exhibits exact steering symmetry between left and right turns", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();

      const inputTurnLeft: DrivetrainInput = { leftThrottle: 0.4, rightThrottle: 0.8 };
      const inputTurnRight: DrivetrainInput = { leftThrottle: 0.8, rightThrottle: 0.4 };

      const resLeft = stepDrivetrainDynamics(config, state, inputTurnLeft, 0.02);
      const resRight = stepDrivetrainDynamics(config, state, inputTurnRight, 0.02);

      // Longitudinal acceleration should be identical
      expect(resLeft.state.longitudinalAccelerationMps2).toBeCloseTo(
        resRight.state.longitudinalAccelerationMps2,
        6
      );

      // Yaw torques and angular accelerations must be exact opposite signs
      expect(resLeft.diagnostics.netYawTorqueNm).toBeCloseTo(
        -resRight.diagnostics.netYawTorqueNm,
        6
      );
      expect(resLeft.state.yawRateRadPerSec).toBeCloseTo(-resRight.state.yawRateRadPerSec, 6);
      expect(resLeft.state.headingRadians).toBeCloseTo(-resRight.state.headingRadians, 6);
      expect(resLeft.state.zMeters).toBeCloseTo(-resRight.state.zMeters, 6);
    });

    it("executes an in-place spin turn (zero longitudinal acceleration, pure yaw)", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();
      // Left reverse full, Right forward full
      const input: DrivetrainInput = { leftThrottle: -1.0, rightThrottle: 1.0 };
      const dt = 0.05;

      const { state: nextState, diagnostics } = stepDrivetrainDynamics(config, state, input, dt);

      // F_L = -15 N, F_R = +15 N
      expect(diagnostics.leftDriveForceN).toBeCloseTo(-15.0, 4);
      expect(diagnostics.rightDriveForceN).toBeCloseTo(15.0, 4);

      // Net longitudinal force = 0 -> zero linear acceleration
      expect(diagnostics.netLongitudinalForceN).toBeCloseTo(0, 6);
      expect(nextState.longitudinalAccelerationMps2).toBeCloseTo(0, 6);
      expect(nextState.longitudinalVelocityMps).toBeCloseTo(0, 6);
      expect(nextState.xMeters).toBeCloseTo(0, 6);
      expect(nextState.zMeters).toBeCloseTo(0, 6);

      // Pure yaw torque: τ = (0.6 / 2) * (15 - (-15)) = 0.3 * 30 = 9.0 N·m
      expect(diagnostics.netYawTorqueNm).toBeCloseTo(9.0, 4);
      // α = 9.0 / 0.5 = 18.0 rad/s²
      expect(nextState.angularAccelerationRadPerSec2).toBeCloseTo(18.0, 4);
      // ω_yaw = 18 * 0.05 = 0.9 rad/s
      expect(nextState.yawRateRadPerSec).toBeCloseTo(0.9, 4);
    });

    it("supports 4WD differential drive summing forces across all 4 wheels", () => {
      const config4WD = createMock4WDRobotConfig();
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };
      const dt = 0.05;

      const { state: nextState, diagnostics } = stepDrivetrainDynamics(
        config4WD,
        state,
        input,
        dt
      );

      // Each of 4 motors has stall torque 1.0 N·m / radius 0.08 m = 12.5 N
      // 4 wheels * 12.5 N = 50.0 N total
      expect(diagnostics.wheels.length).toBe(4);
      expect(diagnostics.leftDriveForceN).toBeCloseTo(25.0, 3);
      expect(diagnostics.rightDriveForceN).toBeCloseTo(25.0, 3);
      expect(diagnostics.netLongitudinalForceN).toBeCloseTo(50.0, 3);

      // a_x = 50 N / 16 kg = 3.125 m/s²
      expect(nextState.longitudinalAccelerationMps2).toBeCloseTo(3.125, 4);
      expect(nextState.longitudinalVelocityMps).toBeCloseTo(3.125 * 0.05, 4);
    });
  });

  describe("4. Integration & Numerical Stability", () => {
    it("scales velocity update linearly with timestep", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      const res1 = stepDrivetrainDynamics(config, state, input, 0.01);
      const res2 = stepDrivetrainDynamics(config, state, input, 0.02);

      expect(res2.state.longitudinalVelocityMps).toBeCloseTo(
        2 * res1.state.longitudinalVelocityMps,
        5
      );
    });

    it("implements semi-implicit Euler position integration using updated velocity", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };
      const dt = 0.1;

      const { state: nextState } = stepDrivetrainDynamics(config, state, input, dt);

      // Under semi-implicit Euler, newX = X(0) + newVx * dt (NOT oldVx * dt)
      // Since oldVx = 0, an explicit Euler step would have kept X = 0!
      // Semi-implicit uses newVx, so X = newVx * dt > 0.
      expect(nextState.xMeters).toBeGreaterThan(0);
      expect(nextState.xMeters).toBeCloseTo(nextState.longitudinalVelocityMps * dt, 6);
    });

    it("integrates smooth multi-step state progression over 10 consecutive frames", () => {
      const config = createMock2WDRobotConfig();
      let state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };
      const dt = 0.02;

      for (let i = 0; i < 10; i++) {
        const res = stepDrivetrainDynamics(config, state, input, dt);
        expect(res.state.stepCount).toBe(i + 1);
        expect(res.state.timeSeconds).toBeCloseTo((i + 1) * dt, 6);
        expect(res.state.longitudinalVelocityMps).toBeGreaterThan(
          state.longitudinalVelocityMps
        );
        state = res.state;
      }

      expect(state.stepCount).toBe(10);
      expect(state.timeSeconds).toBeCloseTo(0.2, 6);
      expect(state.xMeters).toBeGreaterThan(0);
    });

    it("produces deterministic output across repeated runs", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState({ x: 1.5, z: -0.5, heading: 0.2 });
      const input: DrivetrainInput = { leftThrottle: 0.6, rightThrottle: 0.9 };

      const res1 = stepDrivetrainDynamics(config, state, input, 0.02);
      const res2 = stepDrivetrainDynamics(config, state, input, 0.02);

      expect(res1.state).toEqual(res2.state);
      expect(res1.diagnostics).toEqual(res2.diagnostics);
    });

    it("preserves immutability of configuration, current state, and input", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState({ x: 2.0, z: 1.0, heading: 0.5 });
      const input: DrivetrainInput = { leftThrottle: 0.5, rightThrottle: 0.5 };

      const configClone = JSON.parse(JSON.stringify(config));
      const stateClone = JSON.parse(JSON.stringify(state));
      const inputClone = JSON.parse(JSON.stringify(input));

      stepDrivetrainDynamics(config, state, input, 0.05);

      expect(config).toEqual(configClone);
      expect(state).toEqual(stateClone);
      expect(input).toEqual(inputClone);
    });

    it("normalizes angle to (-π, π]", () => {
      expect(normalizeAngle(0)).toBe(0);
      expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 6);
      expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 6);
      expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 6);
      expect(normalizeAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
      expect(normalizeAngle(2 * Math.PI + 0.1)).toBeCloseTo(0.1, 6);
    });

    it("rejects non-positive and non-finite timesteps", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      expect(() => stepDrivetrainDynamics(config, state, input, 0)).toThrow(/Invalid timestep/);
      expect(() => stepDrivetrainDynamics(config, state, input, -0.05)).toThrow(/Invalid timestep/);
      expect(() => stepDrivetrainDynamics(config, state, input, NaN)).toThrow(/Invalid timestep/);
      expect(() => stepDrivetrainDynamics(config, state, input, Infinity)).toThrow(/Invalid timestep/);
    });

    it("rejects non-finite input values preventing NaN propagation", () => {
      const config = createMock2WDRobotConfig();
      const state = createInitialSimulationState();

      expect(() =>
        stepDrivetrainDynamics(config, state, { leftThrottle: NaN, rightThrottle: 1.0 }, 0.02)
      ).toThrow(/finite numbers/);

      expect(() =>
        stepDrivetrainDynamics(config, state, { leftThrottle: 1.0, rightThrottle: Infinity }, 0.02)
      ).toThrow(/finite numbers/);
    });

    it("rejects invalid configuration mass and inertia", () => {
      const configInvalidMass = createMock2WDRobotConfig({ totalMassKg: 0 });
      const state = createInitialSimulationState();
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      expect(() =>
        stepDrivetrainDynamics(configInvalidMass, state, input, 0.02)
      ).toThrow(/totalMassKg/);

      const configInvalidInertia = createMock2WDRobotConfig({ yawInertiaKgM2: -1.0 });
      expect(() =>
        stepDrivetrainDynamics(configInvalidInertia, state, input, 0.02)
      ).toThrow(/yawInertiaKgM2/);
    });
  });
});
