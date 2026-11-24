import { describe, expect, it } from "vitest";
import {
  advanceSimulation,
  createInitialRunnerState,
  DEFAULT_FIXED_TIMESTEP_SECONDS,
  resetBatteryCutoff,
  stepSimulationFixed,
} from "./simulationRunner";
import {
  calculateBatteryOperatingPoint,
  calculateBatteryTerminalVoltage,
  DEFAULT_BATTERY_INTERNAL_RESISTANCE_OHM,
  estimateMotorCurrent,
  estimateTotalDriveCurrent,
  resolveBatteryCutoffVoltage,
  resolveBatteryInternalResistance,
  resolveBatteryOpenCircuitVoltage,
} from "./batteryDynamics";
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
  const normalPerWheelN = (totalMassKg * 9.80665) / 2;

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
        motorId: "m-l",
        name: "Left Motor",
        side: "left",
        slotIndex: 0,
        stallTorqueNm,
        noLoadRpm,
        noLoadAngularVelocityRadPerSec,
        nominalVoltageV: 12.0,
        provenance: { source: "catalogue:motor:test", verified: true },
      },
      {
        motorId: "m-r",
        name: "Right Motor",
        side: "right",
        slotIndex: 0,
        stallTorqueNm,
        noLoadRpm,
        noLoadAngularVelocityRadPerSec,
        nominalVoltageV: 12.0,
        provenance: { source: "catalogue:motor:test", verified: true },
      },
    ],
    wheels: [
      {
        wheelId: "w-l",
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
        wheelId: "w-r",
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
      name: "3S LiPo Pack",
      chemistry: "lipo",
      cellCountS: 3,
      nominalVoltageV: 11.1,
      fullyChargedVoltageV: 12.6,
      cutoffVoltageV: 9.0,
      capacityMah: 2200,
      provenance: { source: "catalogue:battery:test", verified: true },
    },
    normalLoads: {
      totalNormalForceN: totalMassKg * 9.80665,
      leftSideNormalForceN: normalPerWheelN,
      rightSideNormalForceN: normalPerWheelN,
      perWheelLoads: [
        { wheelId: "w-l", normalForceN: normalPerWheelN, isDriven: true },
        { wheelId: "w-r", normalForceN: normalPerWheelN, isDriven: true },
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
  const normalPerWheelN = (totalMassKg * 9.80665) / 4;

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
        nominalVoltageV: 12.0,
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
        nominalVoltageV: 12.0,
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
        nominalVoltageV: 12.0,
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
        nominalVoltageV: 12.0,
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
    battery: {
      batteryId: "bat-4wd",
      name: "4S LiPo Pack",
      chemistry: "lipo",
      cellCountS: 4,
      nominalVoltageV: 14.8,
      fullyChargedVoltageV: 16.8,
      cutoffVoltageV: 12.0,
      capacityMah: 4000,
      provenance: { source: "cat", verified: true },
    },
    normalLoads: null,
    assumptions: [],
    validity: "valid",
    warnings: [],
  };
}

describe("simulationRunner & batteryDynamics", () => {
  describe("1. Battery Dynamics & Electrical Demand", () => {
    const config2WD = createMock2WDRobotConfig();

    it("resolves open-circuit and cutoff voltages from battery config", () => {
      const voc = resolveBatteryOpenCircuitVoltage(config2WD.battery);
      expect(voc).toBeCloseTo(12.6, 3); // fully charged 3S

      const vCutoff = resolveBatteryCutoffVoltage(config2WD.battery);
      expect(vCutoff).toBeCloseTo(9.0, 3); // 3S cutoff
    });

    it("provides explicit provenance assumption for internal resistance", () => {
      const defaultRes = resolveBatteryInternalResistance();
      expect(defaultRes.resistanceOhm).toBe(DEFAULT_BATTERY_INTERNAL_RESISTANCE_OHM);
      expect(defaultRes.assumption.source).toBe("standard-default");

      const userRes = resolveBatteryInternalResistance({ internalResistanceOhm: 0.05 });
      expect(userRes.resistanceOhm).toBe(0.05);
      expect(userRes.assumption.source).toBe("user-specified");
    });

    it("calculates terminal voltage with sag: V_terminal = V_oc - I * R_i", () => {
      const voc = 12.0;
      const current = 10.0; // 10 A
      const rInternal = 0.05; // 50 mΩ

      const vTerminal = calculateBatteryTerminalVoltage(voc, current, rInternal);
      // 12.0 - 10.0 * 0.05 = 11.5 V
      expect(vTerminal).toBeCloseTo(11.5, 4);
    });

    it("bounds terminal voltage to non-negative values", () => {
      const voc = 10.0;
      const current = 500.0; // extreme load
      const rInternal = 0.1;

      const vTerminal = calculateBatteryTerminalVoltage(voc, current, rInternal);
      expect(vTerminal).toBe(0);
    });

    it("estimates motor current proportional to electrical torque constant", () => {
      const motor = config2WD.motors[0];
      // At rest (omega = 0) with full throttle (u = 1.0) under 12.0 V:
      // Kt = 12.0 / 31.4159 rad/s = 0.38197 N·m/A
      // I_stall = 1.5 N·m / 0.38197 = 3.927 A
      const currentAtStall = estimateMotorCurrent(motor, 1.0, 0, 12.0);
      expect(currentAtStall).toBeCloseTo(3.927, 2);

      // At zero throttle: current must be 0
      const currentAtZeroThrottle = estimateMotorCurrent(motor, 0, 0, 12.0);
      expect(currentAtZeroThrottle).toBe(0);

      // At no-load speed in commanded direction: back-EMF matches voltage, current = 0
      const currentAtNoLoad = estimateMotorCurrent(
        motor,
        1.0,
        motor.noLoadAngularVelocityRadPerSec,
        12.0
      );
      expect(currentAtNoLoad).toBeCloseTo(0, 3);
    });

    it("sums current demand across multiple motors", () => {
      const totalCurrent = estimateTotalDriveCurrent(
        config2WD.motors,
        1.0,
        1.0,
        0,
        0,
        12.0
      );
      // 2 motors stalled at ~3.927 A each = ~7.854 A
      expect(totalCurrent).toBeCloseTo(7.854, 2);
    });

    it("calculates closed-form battery operating point under load", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      const diag = calculateBatteryOperatingPoint(
        config2WD,
        runnerState.simulationState,
        input,
        { internalResistanceOhm: 0.05 }
      );

      // Voc = 12.6 V, motors stalled
      expect(diag.openCircuitVoltageV).toBeCloseTo(12.6, 2);
      expect(diag.currentDrawA).toBeGreaterThan(0);
      expect(diag.voltageSagV).toBeGreaterThan(0);
      expect(diag.terminalVoltageV).toBeLessThan(diag.openCircuitVoltageV);
      expect(diag.terminalVoltageV).toBeCloseTo(
        diag.openCircuitVoltageV - diag.currentDrawA * 0.05,
        4
      );
      expect(diag.isCutoff).toBe(false);
    });

    it("clamps motor current during counter-rotation (plugging) to operating stall current", () => {
      const motor = config2WD.motors[0];
      const operatingV = 12.0;
      // Nominal stall current = 1.5 / (12.0 / 31.4159) = 3.927 A
      // Moving backward (omega = -25 rad/s) while forward throttle applied (u = +1.0)
      const currentPluggingFwd = estimateMotorCurrent(motor, 1.0, -25.0, operatingV);
      expect(currentPluggingFwd).toBeCloseTo(3.927, 2);
      expect(currentPluggingFwd).toBeLessThanOrEqual(3.927 + 1e-6);

      // Moving forward (omega = +25 rad/s) while reverse throttle applied (u = -1.0)
      const currentPluggingRev = estimateMotorCurrent(motor, -1.0, 25.0, operatingV);
      expect(currentPluggingRev).toBeCloseTo(3.927, 2);
      expect(currentPluggingRev).toBeLessThanOrEqual(3.927 + 1e-6);
    });

    it("prevents unclamped back-EMF from corrupting closed-form equilibrium during asymmetric overspeed", () => {
      // Left motor: partial throttle u = 0.2 at full no-load speed (omega = 31.4159 rad/s)
      // Back-EMF = Kt * omega = 12.0 V. Applied voltage at full Voc (12.0V) is 0.2 * 12.0 = 2.4 V.
      // Because back-EMF (12V) > applied voltage (2.4V), left motor current is clamped to 0.
      // Right motor: stalled (omega = 0) at full throttle u = 1.0.
      const state = {
        ...createInitialRunnerState(config2WD).simulationState,
        leftWheelAngularVelocityRadPerSec: config2WD.motors[0].noLoadAngularVelocityRadPerSec,
        rightWheelAngularVelocityRadPerSec: 0,
      };
      const input: DrivetrainInput = { leftThrottle: 0.2, rightThrottle: 1.0 };
      const rInternal = 0.05;

      const diag = calculateBatteryOperatingPoint(config2WD, state, input, {
        internalResistanceOhm: rInternal,
        openCircuitVoltageV: 12.0,
      });

      // Left motor must draw 0 A
      const leftMotorCurrent = estimateMotorCurrent(
        config2WD.motors[0],
        0.2,
        config2WD.motors[0].noLoadAngularVelocityRadPerSec,
        diag.terminalVoltageV
      );
      expect(leftMotorCurrent).toBe(0);

      // Right motor draws I_R = V_terminal / R_winding
      // With R_winding = 12.0 / 3.927 = 3.0556 Ohms
      expect(diag.currentDrawA).toBeCloseTo(diag.terminalVoltageV / (12.0 / 3.927), 3);
      // Intermediate closed-form equilibrium and recalculated terminal voltage must be strictly consistent
      expect(diag.terminalVoltageV).toBeCloseTo(12.0 - diag.currentDrawA * rInternal, 5);
      expect(diag.voltageSagV).toBeCloseTo(diag.currentDrawA * rInternal, 5);
    });

    it("calculates correct current draw and terminal voltage under asymmetric throttle commands", () => {
      const runnerState = createInitialRunnerState(config2WD);
      // Left motor at 40% throttle, Right motor at 100% throttle
      const inputAsymmetric: DrivetrainInput = { leftThrottle: 0.4, rightThrottle: 1.0 };
      const rInternal = 0.05;

      const diagAsym = calculateBatteryOperatingPoint(
        config2WD,
        runnerState.simulationState,
        inputAsymmetric,
        { internalResistanceOhm: rInternal, openCircuitVoltageV: 12.0 }
      );

      // Stalled motors: I_L = 0.4 * (V / R), I_R = 1.0 * (V / R)
      // Ratio of currents must be 1.0 / 0.4 = 2.5
      const currentL = estimateMotorCurrent(config2WD.motors[0], 0.4, 0, diagAsym.terminalVoltageV);
      const currentR = estimateMotorCurrent(config2WD.motors[1], 1.0, 0, diagAsym.terminalVoltageV);
      expect(currentR / currentL).toBeCloseTo(2.5, 4);
      expect(diagAsym.currentDrawA).toBeCloseTo(currentL + currentR, 5);

      // Terminal voltage sags more than 0.4 on both sides, and less than 1.0 on both sides
      const diagLow = calculateBatteryOperatingPoint(
        config2WD,
        runnerState.simulationState,
        { leftThrottle: 0.4, rightThrottle: 0.4 },
        { internalResistanceOhm: rInternal, openCircuitVoltageV: 12.0 }
      );
      const diagHigh = calculateBatteryOperatingPoint(
        config2WD,
        runnerState.simulationState,
        { leftThrottle: 1.0, rightThrottle: 1.0 },
        { internalResistanceOhm: rInternal, openCircuitVoltageV: 12.0 }
      );

      expect(diagAsym.terminalVoltageV).toBeLessThan(diagLow.terminalVoltageV);
      expect(diagAsym.terminalVoltageV).toBeGreaterThan(diagHigh.terminalVoltageV);
      expect(diagAsym.voltageSagV).toBeGreaterThan(diagLow.voltageSagV);
      expect(diagAsym.voltageSagV).toBeLessThan(diagHigh.voltageSagV);
    });

    it("triggers low-voltage cutoff when terminal voltage drops below threshold", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      // Set artificially high cutoff voltage (12.5 V) so sag immediately trips cutoff
      const diag = calculateBatteryOperatingPoint(
        config2WD,
        runnerState.simulationState,
        input,
        { cutoffVoltageV: 12.5, internalResistanceOhm: 0.1 }
      );

      expect(diag.isCutoff).toBe(true);
      expect(diag.terminalVoltageV).toBe(0);
      expect(diag.currentDrawA).toBe(0);
    });
  });

  describe("2. Fixed-Timestep Simulation Runner", () => {
    const config2WD = createMock2WDRobotConfig();

    it("initializes runner state with correct defaults", () => {
      const runnerState = createInitialRunnerState(config2WD, { x: 1.0, z: -0.5, heading: 0.1 });
      expect(runnerState.accumulatorSeconds).toBe(0);
      expect(runnerState.isCutoff).toBe(false);
      expect(runnerState.totalSimulatedTimeSeconds).toBe(0);
      expect(runnerState.totalPhysicsSteps).toBe(0);
      expect(runnerState.simulationState.xMeters).toBe(1.0);
      expect(runnerState.simulationState.zMeters).toBe(-0.5);
      expect(runnerState.simulationState.headingRadians).toBeCloseTo(0.1, 5);
      expect(runnerState.simulationState.batteryTerminalVoltageV).toBeCloseTo(12.6, 2);
    });

    it("executes exact multiple-step duration with fixed timestep (1/120s)", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };
      const duration = 0.05; // 0.05 / (1/120) = exactly 6 steps

      const res = advanceSimulation(config2WD, runnerState, input, duration);

      expect(res.stepsExecuted).toBe(6);
      expect(res.fixedTimestepSeconds).toBe(DEFAULT_FIXED_TIMESTEP_SECONDS);
      expect(res.timeAdvancedSeconds).toBeCloseTo(0.05, 6);
      expect(res.accumulatorRemainderSeconds).toBeCloseTo(0, 6);
      expect(res.runnerState.totalPhysicsSteps).toBe(6);
      expect(res.runnerState.totalSimulatedTimeSeconds).toBeCloseTo(0.05, 6);
      expect(res.stepDiagnostics.length).toBe(6);
    });

    it("handles non-exact durations via accumulator remainder strategy without modifying fixed dt", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };
      const duration = 0.01; // 0.01 s requested with dt = 1/120 (~0.008333 s)

      const res1 = advanceSimulation(config2WD, runnerState, input, duration);

      // Should execute 1 step (1/120 s) and leave 0.01 - 0.008333 = 0.001667 s in accumulator
      expect(res1.stepsExecuted).toBe(1);
      expect(res1.timeAdvancedSeconds).toBeCloseTo(1 / 120, 6);
      expect(res1.accumulatorRemainderSeconds).toBeCloseTo(0.01 - 1 / 120, 6);
      expect(res1.runnerState.accumulatorSeconds).toBeCloseTo(0.01 - 1 / 120, 6);

      // Second call with 0.01 s: accumulator becomes ~0.011667 s -> executes 1 step, leaves ~0.003333 s
      const res2 = advanceSimulation(config2WD, res1.runnerState, input, duration);
      expect(res2.stepsExecuted).toBe(1);
      expect(res2.accumulatorRemainderSeconds).toBeCloseTo(0.02 - 2 / 120, 6);
    });

    it("handles zero-duration advance requests without executing steps", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 0.5, rightThrottle: 0.5 };

      const res = advanceSimulation(config2WD, runnerState, input, 0);

      expect(res.stepsExecuted).toBe(0);
      expect(res.timeAdvancedSeconds).toBe(0);
      expect(res.stepDiagnostics.length).toBe(0);
      expect(res.runnerState.totalPhysicsSteps).toBe(0);
    });

    it("produces deterministic output across identical advance requests", () => {
      const runnerState1 = createInitialRunnerState(config2WD, { x: 0, z: 0, heading: 0.3 });
      const runnerState2 = createInitialRunnerState(config2WD, { x: 0, z: 0, heading: 0.3 });
      const input: DrivetrainInput = { leftThrottle: 0.7, rightThrottle: 0.9 };

      const res1 = advanceSimulation(config2WD, runnerState1, input, 0.04);
      const res2 = advanceSimulation(config2WD, runnerState2, input, 0.04);

      expect(res1.runnerState).toEqual(res2.runnerState);
      expect(res1.stepDiagnostics).toEqual(res2.stepDiagnostics);
    });

    it("preserves immutability of configuration, runner state, and input", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 0.8, rightThrottle: 0.8 };

      const configClone = JSON.parse(JSON.stringify(config2WD));
      const stateClone = JSON.parse(JSON.stringify(runnerState));
      const inputClone = JSON.parse(JSON.stringify(input));

      advanceSimulation(config2WD, runnerState, input, 0.05);

      expect(config2WD).toEqual(configClone);
      expect(runnerState).toEqual(stateClone);
      expect(input).toEqual(inputClone);
    });

    it("enforces maxSubSteps to prevent runaway execution", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };
      // Request huge duration (10 seconds = 1200 steps at 120 Hz)
      const res = advanceSimulation(config2WD, runnerState, input, 10.0, { maxSubSteps: 30 });

      // Capped at 30 steps
      expect(res.stepsExecuted).toBe(30);
      expect(res.stepDiagnostics.length).toBe(30);
    });

    it("rejects invalid timestep and duration parameters", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      expect(() => advanceSimulation(config2WD, runnerState, input, -0.01)).toThrow(/durationSeconds/);
      expect(() => advanceSimulation(config2WD, runnerState, input, NaN)).toThrow(/durationSeconds/);
      expect(() => advanceSimulation(config2WD, runnerState, input, 0.05, { fixedTimestepSeconds: 0 })).toThrow(/fixedTimestepSeconds/);
      expect(() => advanceSimulation(config2WD, runnerState, input, 0.05, { fixedTimestepSeconds: -0.01 })).toThrow(/fixedTimestepSeconds/);
    });
  });

  describe("3. Battery-Drivetrain Integration", () => {
    const config2WD = createMock2WDRobotConfig();

    it("reduces motor push force and acceleration when battery voltage sags", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      // Case A: Ideal stiff battery (0 internal resistance, no sag)
      const resIdeal = stepSimulationFixed(
        config2WD,
        runnerState.simulationState,
        input,
        0.01,
        { battery: { internalResistanceOhm: 0.0, openCircuitVoltageV: 12.0 } }
      );

      // Case B: High-resistance battery (0.2 Ω, significant sag)
      const resSag = stepSimulationFixed(
        config2WD,
        runnerState.simulationState,
        input,
        0.01,
        { battery: { internalResistanceOhm: 0.2, openCircuitVoltageV: 12.0 } }
      );

      expect(resSag.batteryDiagnostics.voltageSagV).toBeGreaterThan(0);
      expect(resSag.batteryDiagnostics.terminalVoltageV).toBeLessThan(12.0);
      expect(resSag.state.longitudinalAccelerationMps2).toBeLessThan(
        resIdeal.state.longitudinalAccelerationMps2
      );
    });

    it("shuts down motor drive force when low-voltage cutoff trips", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      // Force cutoff by setting cutoff threshold high
      const resCutoff = advanceSimulation(
        config2WD,
        runnerState,
        input,
        0.05,
        { battery: { cutoffVoltageV: 12.5, internalResistanceOhm: 0.1 } }
      );

      expect(resCutoff.runnerState.isCutoff).toBe(true);
      expect(resCutoff.runnerState.simulationState.isBatteryCutoff).toBe(true);
      expect(resCutoff.runnerState.simulationState.batteryTerminalVoltageV).toBe(0);
      expect(resCutoff.runnerState.simulationState.totalCurrentDrawA).toBe(0);

      // In cutoff, drive force must be zero
      expect(resCutoff.runnerState.simulationState.netDriveForceN).toBe(0);
      expect(resCutoff.runnerState.simulationState.longitudinalAccelerationMps2).toBe(0);
    });

    it("allows resetting the battery cutoff latch via resetBatteryCutoff", () => {
      let runnerState = createInitialRunnerState(config2WD);
      runnerState = { ...runnerState, isCutoff: true };

      const resetState = resetBatteryCutoff(runnerState);
      expect(resetState.isCutoff).toBe(false);
      expect(resetState.simulationState.isBatteryCutoff).toBe(false);
    });

    it("keeps low-voltage cutoff latched when throttle is released to neutral until reset", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const inputHigh: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      // Step 1: Force cutoff by setting a high cutoff threshold (12.5 V)
      const resCutoff = advanceSimulation(
        config2WD,
        runnerState,
        inputHigh,
        0.05,
        { battery: { cutoffVoltageV: 12.5, internalResistanceOhm: 0.1 } }
      );

      expect(resCutoff.runnerState.isCutoff).toBe(true);
      expect(resCutoff.runnerState.simulationState.isBatteryCutoff).toBe(true);
      expect(resCutoff.runnerState.simulationState.batteryTerminalVoltageV).toBe(0);

      // Step 2: Release throttle to neutral (0, 0) and advance simulation further
      const inputNeutral: DrivetrainInput = { leftThrottle: 0, rightThrottle: 0 };
      const resNeutral = advanceSimulation(
        config2WD,
        resCutoff.runnerState,
        inputNeutral,
        0.1,
        { battery: { cutoffVoltageV: 12.5, internalResistanceOhm: 0.1 } }
      );

      // Cutoff MUST remain latched, and battery voltage must remain 0
      expect(resNeutral.runnerState.isCutoff).toBe(true);
      expect(resNeutral.runnerState.simulationState.isBatteryCutoff).toBe(true);
      expect(resNeutral.runnerState.simulationState.batteryTerminalVoltageV).toBe(0);
      expect(resNeutral.runnerState.simulationState.totalCurrentDrawA).toBe(0);
      expect(resNeutral.runnerState.simulationState.netDriveForceN).toBe(0);

      // Step 3: Advance again with full throttle command to test that power is still locked out
      const resStillLocked = advanceSimulation(
        config2WD,
        resNeutral.runnerState,
        inputHigh,
        0.05,
        { battery: { cutoffVoltageV: 12.5, internalResistanceOhm: 0.1 } }
      );
      expect(resStillLocked.runnerState.isCutoff).toBe(true);
      expect(resStillLocked.runnerState.simulationState.netDriveForceN).toBe(0);
      expect(resStillLocked.runnerState.simulationState.longitudinalAccelerationMps2).toBe(0);

      // Step 4: Explicitly reset cutoff latch
      const unlatchedState = resetBatteryCutoff(resStillLocked.runnerState);
      expect(unlatchedState.isCutoff).toBe(false);
      expect(unlatchedState.simulationState.isBatteryCutoff).toBe(false);

      // Step 5: Advance with safe cutoff voltage (9.0 V) to verify power recovery
      const resRecovered = advanceSimulation(
        config2WD,
        unlatchedState,
        inputHigh,
        0.05,
        { battery: { cutoffVoltageV: 9.0, internalResistanceOhm: 0.05 } }
      );
      expect(resRecovered.runnerState.isCutoff).toBe(false);
      expect(resRecovered.runnerState.simulationState.isBatteryCutoff).toBe(false);
      expect(resRecovered.runnerState.simulationState.batteryTerminalVoltageV).toBeGreaterThan(9.0);
      expect(resRecovered.runnerState.simulationState.netDriveForceN).toBeGreaterThan(0);
      expect(resRecovered.runnerState.simulationState.longitudinalAccelerationMps2).toBeGreaterThan(0);
    });

    it("simulates 4WD configuration with 4 motors drawing current from single battery pack", () => {
      const config4WD = createMock4WDRobotConfig();
      const runnerState = createInitialRunnerState(config4WD);
      const input: DrivetrainInput = { leftThrottle: 1.0, rightThrottle: 1.0 };

      const res4WD = advanceSimulation(config4WD, runnerState, input, 0.05);

      expect(res4WD.stepsExecuted).toBe(6);
      expect(res4WD.batteryDiagnostics.currentDrawA).toBeGreaterThan(0);
      expect(res4WD.runnerState.simulationState.xMeters).toBeGreaterThan(0);
      expect(res4WD.runnerState.simulationState.stepCount).toBe(6);
    });

    it("executes smooth 1-second multi-step simulation without NaN or drift", () => {
      const runnerState = createInitialRunnerState(config2WD);
      const input: DrivetrainInput = { leftThrottle: 0.8, rightThrottle: 0.8 };
      // Advance by 1 full second in 10 sequential 100ms frames
      let current = runnerState;

      for (let frame = 0; frame < 10; frame++) {
        const res = advanceSimulation(config2WD, current, input, 0.1);
        expect(res.stepsExecuted).toBe(12); // 0.1s / (1/120s) = 12 steps
        current = res.runnerState;
      }

      expect(current.totalPhysicsSteps).toBe(120);
      expect(current.totalSimulatedTimeSeconds).toBeCloseTo(1.0, 5);
      expect(current.simulationState.xMeters).toBeGreaterThan(0);
      expect(Number.isFinite(current.simulationState.xMeters)).toBe(true);
      expect(Number.isFinite(current.simulationState.longitudinalVelocityMps)).toBe(true);
    });
  });
});
