/**
 * Pure Battery Dynamics & Electrical Demand Engine for Robot Wars.
 *
 * Implements a transparent, deterministic battery voltage sag model and motor
 * electrical current demand calculations.
 *
 * Physics & Equations:
 * 1. Open-Circuit Voltage:
 *    V_oc = configured open-circuit voltage, or fully charged voltage, or nominal voltage.
 *
 * 2. Motor Electrical Demand:
 *    In canonical SI base units for DC motors, the torque constant Kt (N·m/A) and
 *    back-EMF constant Ke (V/(rad/s)) are identical:
 *      Kt = Ke = V_nom / ω_noLoad
 *    The motor winding resistance is:
 *      R_winding = V_nom / I_stall = (V_nom)² / (τ_stall * ω_noLoad)
 *    Under applied voltage V_app = |u| * V_terminal, the motor draws current:
 *      I_motor = max(0, min(I_stall * (V_terminal / V_nom), (V_app - V_bemf) / R_winding))
 *      where V_bemf = min(V_app, Ke * |ω|) when shaft moves in commanded direction.
 *    Neutral throttle (|u| = 0) draws strictly 0 A.
 *
 * 3. Total Battery Current:
 *    I_total = Σ I_motor_i (sum over all active drive motors).
 *
 * 4. Voltage Sag Model:
 *    V_terminal = max(0, V_oc - I_total * R_internal)
 *
 * 5. Low-Voltage Cutoff:
 *    If V_terminal <= V_cutoff, low-voltage protection trips:
 *    Motors are shut down (effective terminal voltage = 0 V, current = 0 A).
 *
 * Provenance & Assumptions:
 * - Internal resistance is omitted from catalogue data to avoid fabrication;
 *   a configurable standard default assumption of 0.025 Ω (25 mΩ) is applied.
 * - Completely decoupled from React, Three.js, Zustand, DOM, and UI rendering.
 */

import type {
  BatteryDynamicsDiagnostics,
  BatterySimulationConfig,
  BatterySimulationOptions,
  DrivetrainInput,
  MotorSimulationConfig,
  SimulationAssumption,
  SimulationRobotConfig,
  SimulationState,
} from "../types/simulation.types";

/**
 * Standard default assumed internal resistance for multi-cell LiPo battery packs (25 mΩ).
 */
export const DEFAULT_BATTERY_INTERNAL_RESISTANCE_OHM = 0.025;

/**
 * Standard default nominal battery voltage when unspecified (12.0 V).
 */
export const DEFAULT_BATTERY_NOMINAL_VOLTAGE_V = 12.0;

/**
 * Standard nominal voltage per LiPo cell (3.7 V/cell).
 */
export const DEFAULT_LIPO_CELL_NOMINAL_V = 3.7;

/**
 * Standard maximum fully charged voltage per LiPo cell (4.2 V/cell).
 */
export const DEFAULT_LIPO_CELL_FULL_V = 4.2;

/**
 * Standard safe discharge cutoff floor per LiPo cell (3.0 V/cell).
 */
export const DEFAULT_LIPO_CELL_CUTOFF_V = 3.0;

/**
 * Explicit assumption record for default battery internal resistance.
 */
export const BATTERY_INTERNAL_RESISTANCE_ASSUMPTION: SimulationAssumption = {
  id: "battery-assumed-internal-resistance",
  parameter: "battery.internalResistanceOhm",
  value: DEFAULT_BATTERY_INTERNAL_RESISTANCE_OHM,
  unit: "Ohms",
  source: "standard-default",
  description:
    "Battery catalogue data omits internal resistance to avoid unverified fabrication; simulation applies configurable standard default of 0.025 Ω (25 mΩ) typical for multi-cell LiPo packs.",
};

/**
 * Resolves the open circuit voltage of the battery pack.
 */
export function resolveBatteryOpenCircuitVoltage(
  battery: BatterySimulationConfig | null,
  options?: BatterySimulationOptions
): number {
  if (
    options?.openCircuitVoltageV !== undefined &&
    Number.isFinite(options.openCircuitVoltageV) &&
    options.openCircuitVoltageV > 0
  ) {
    return options.openCircuitVoltageV;
  }
  if (
    battery?.fullyChargedVoltageV !== undefined &&
    Number.isFinite(battery.fullyChargedVoltageV) &&
    battery.fullyChargedVoltageV > 0
  ) {
    return battery.fullyChargedVoltageV;
  }
  if (
    battery?.nominalVoltageV !== undefined &&
    Number.isFinite(battery.nominalVoltageV) &&
    battery.nominalVoltageV > 0
  ) {
    return battery.nominalVoltageV;
  }
  return DEFAULT_BATTERY_NOMINAL_VOLTAGE_V;
}

/**
 * Resolves the low-voltage cutoff threshold for the battery pack.
 */
export function resolveBatteryCutoffVoltage(
  battery: BatterySimulationConfig | null,
  options?: BatterySimulationOptions
): number {
  if (
    options?.cutoffVoltageV !== undefined &&
    Number.isFinite(options.cutoffVoltageV) &&
    options.cutoffVoltageV > 0
  ) {
    return options.cutoffVoltageV;
  }
  if (
    battery?.cutoffVoltageV !== undefined &&
    Number.isFinite(battery.cutoffVoltageV) &&
    battery.cutoffVoltageV > 0
  ) {
    return battery.cutoffVoltageV;
  }
  if (battery?.nominalVoltageV !== undefined && battery.nominalVoltageV > 0) {
    // Default to ~81% nominal (equivalent to 3.0V / 3.7V per LiPo cell)
    return battery.nominalVoltageV * (DEFAULT_LIPO_CELL_CUTOFF_V / DEFAULT_LIPO_CELL_NOMINAL_V);
  }
  return DEFAULT_BATTERY_NOMINAL_VOLTAGE_V * (DEFAULT_LIPO_CELL_CUTOFF_V / DEFAULT_LIPO_CELL_NOMINAL_V);
}

/**
 * Resolves the internal resistance and returns an explicit assumption record.
 */
export function resolveBatteryInternalResistance(
  options?: BatterySimulationOptions
): { resistanceOhm: number; assumption: SimulationAssumption } {
  if (
    options?.internalResistanceOhm !== undefined &&
    Number.isFinite(options.internalResistanceOhm) &&
    options.internalResistanceOhm >= 0
  ) {
    return {
      resistanceOhm: options.internalResistanceOhm,
      assumption: {
        id: "battery-user-internal-resistance",
        parameter: "battery.internalResistanceOhm",
        value: options.internalResistanceOhm,
        unit: "Ohms",
        source: "user-specified",
        description: `User-configured battery internal resistance of ${options.internalResistanceOhm} Ω.`,
      },
    };
  }

  return {
    resistanceOhm: DEFAULT_BATTERY_INTERNAL_RESISTANCE_OHM,
    assumption: BATTERY_INTERNAL_RESISTANCE_ASSUMPTION,
  };
}

/**
 * Calculates battery terminal voltage from open-circuit voltage, load current, and internal resistance.
 *
 * V_terminal = max(0, V_oc - I * R_i)
 */
export function calculateBatteryTerminalVoltage(
  openCircuitVoltageV: number,
  currentDrawA: number,
  internalResistanceOhm: number
): number {
  if (!Number.isFinite(openCircuitVoltageV) || openCircuitVoltageV <= 0) {
    return 0;
  }
  const i = Math.max(0, Number.isFinite(currentDrawA) ? currentDrawA : 0);
  const r = Math.max(0, Number.isFinite(internalResistanceOhm) ? internalResistanceOhm : 0);
  const vTerminal = openCircuitVoltageV - i * r;
  return Math.max(0, vTerminal);
}

/**
 * Estimates electrical current demand for a single drive motor under current operating conditions.
 */
export function estimateMotorCurrent(
  motor: MotorSimulationConfig,
  throttle: number,
  currentShaftAngularVelocityRadPerSec: number,
  operatingVoltageV: number
): number {
  if (
    !Number.isFinite(operatingVoltageV) ||
    operatingVoltageV <= 0 ||
    motor.stallTorqueNm <= 0 ||
    motor.noLoadAngularVelocityRadPerSec <= 0
  ) {
    return 0;
  }

  const u = Math.max(-1.0, Math.min(1.0, throttle));
  if (Math.abs(u) < 1e-6) {
    return 0;
  }

  const vNom =
    motor.nominalVoltageV !== undefined && motor.nominalVoltageV > 0
      ? motor.nominalVoltageV
      : DEFAULT_BATTERY_NOMINAL_VOLTAGE_V;

  // Torque constant Kt = Ke = V_nom / ω_noLoad in canonical SI units (N·m/A = V·s/rad)
  const kt = vNom / motor.noLoadAngularVelocityRadPerSec;
  // Stall current at nominal voltage: I_stall = τ_stall / Kt
  const iStallNominal = motor.stallTorqueNm / kt;
  // Motor winding resistance: R = V_nom / I_stall
  const windingResistanceOhm = vNom / iStallNominal;

  // Applied voltage from motor controller / PWM
  const vApplied = Math.abs(u) * operatingVoltageV;

  // Operating speed in the commanded direction opposes applied voltage via back-EMF
  const movingInCommandDirection =
    (u > 0 && currentShaftAngularVelocityRadPerSec > 0) ||
    (u < 0 && currentShaftAngularVelocityRadPerSec < 0);

  const speedMagnitude = Math.abs(currentShaftAngularVelocityRadPerSec);
  const vBackEmf = movingInCommandDirection
    ? Math.min(vApplied, kt * speedMagnitude)
    : 0;

  // Max stall current scaled by available operating voltage: I_stall_op = I_stall * (V_op / V_nom)
  const maxOperatingStallCurrent = iStallNominal * (operatingVoltageV / vNom);

  const currentA = (vApplied - vBackEmf) / windingResistanceOhm;
  return Math.max(0, Math.min(maxOperatingStallCurrent, currentA));
}

/**
 * Estimates total electrical current drawn by all active drive motors.
 */
export function estimateTotalDriveCurrent(
  motors: readonly MotorSimulationConfig[],
  leftThrottle: number,
  rightThrottle: number,
  leftOmega: number,
  rightOmega: number,
  operatingVoltageV: number
): number {
  if (!motors || motors.length === 0 || operatingVoltageV <= 0) {
    return 0;
  }

  let totalCurrentA = 0;
  for (const motor of motors) {
    const throttle = motor.side === "left" ? leftThrottle : rightThrottle;
    const omega = motor.side === "left" ? leftOmega : rightOmega;
    totalCurrentA += estimateMotorCurrent(motor, throttle, omega, operatingVoltageV);
  }

  return totalCurrentA;
}

/**
 * Calculates a self-consistent battery operating point (terminal voltage, current, sag, cutoff).
 *
 * Solves the closed-form coupled circuit equilibrium between battery internal resistance
 * and motor electrical demand.
 */
export function calculateBatteryOperatingPoint(
  config: SimulationRobotConfig,
  state: SimulationState,
  input: DrivetrainInput,
  options?: BatterySimulationOptions,
  wasCutoff = false
): BatteryDynamicsDiagnostics {
  const batteryConfig = config.battery;
  const nominalVoltageV = batteryConfig?.nominalVoltageV ?? DEFAULT_BATTERY_NOMINAL_VOLTAGE_V;
  const openCircuitVoltageV = resolveBatteryOpenCircuitVoltage(batteryConfig, options);
  const cutoffVoltageV = resolveBatteryCutoffVoltage(batteryConfig, options);
  const { resistanceOhm: internalResistanceOhm, assumption: rAssumption } =
    resolveBatteryInternalResistance(options);

  const enableCutoff = options?.enableCutoff ?? true;

  // If cutoff has already latched and cutoff protection is active, remain shutdown
  if (wasCutoff && enableCutoff) {
    return {
      openCircuitVoltageV,
      terminalVoltageV: 0,
      voltageSagV: openCircuitVoltageV,
      currentDrawA: 0,
      internalResistanceOhm,
      isCutoff: true,
      cutoffVoltageV,
      nominalVoltageV,
      assumptions: [rAssumption],
    };
  }

  const leftThrottle = Math.max(-1.0, Math.min(1.0, input.leftThrottle));
  const rightThrottle = Math.max(-1.0, Math.min(1.0, input.rightThrottle));
  const leftOmega = state.leftWheelAngularVelocityRadPerSec;
  const rightOmega = state.rightWheelAngularVelocityRadPerSec;

  // Closed-form coupled solution with piecewise-linear active-set determination:
  // For each motor:
  //   If moving in commanded direction and Kt * |omega| >= |u| * V_terminal:
  //     Motor is overspeed relative to throttle; back-EMF >= V_applied.
  //     estimateMotorCurrent clamps current to 0; motor contributes 0 to load and 0 to back-EMF.
  //   Otherwise:
  //     I_m = (|u_m| * V_terminal - vBemf_m) / R_m
  // Summing active motors: I_total = G_load * V_terminal - I_bemf
  // V_terminal = (V_oc + I_bemf * R_i) / (1 + G_load * R_i)

  interface CandidateMotor {
    readonly kMotor: number;
    readonly iBemf: number;
    readonly thresholdV: number;
  }

  const candidateMotors: CandidateMotor[] = [];

  for (const motor of config.motors) {
    const throttle = motor.side === "left" ? leftThrottle : rightThrottle;
    const omega = motor.side === "left" ? leftOmega : rightOmega;
    const u = Math.max(-1.0, Math.min(1.0, throttle));

    if (Math.abs(u) < 1e-6) continue;

    const vNom = motor.nominalVoltageV ?? nominalVoltageV;
    const kt = vNom / motor.noLoadAngularVelocityRadPerSec;
    const iStallNom = motor.stallTorqueNm / kt;
    const rWinding = vNom / iStallNom;

    const speedMag = Math.abs(omega);
    const movingInCommandDirection =
      (u > 0 && omega > 0) || (u < 0 && omega < 0);

    const absU = Math.abs(u);
    const kMotor = absU / rWinding;

    if (!movingInCommandDirection) {
      // Counter-rotation / plugging or at rest: vBemf does not oppose in motoring sense
      candidateMotors.push({
        kMotor,
        iBemf: 0,
        thresholdV: 0,
      });
    } else {
      // Motoring in commanded direction: back-EMF opposes applied voltage
      const vBemf = kt * speedMag;
      // Threshold terminal voltage below which back-EMF exceeds applied voltage (|u| * V_terminal <= vBemf)
      const thresholdV = vBemf / absU;

      // If thresholdV >= openCircuitVoltageV, motor is overspeed for ALL possible terminal voltages
      // since V_terminal <= V_oc; its current is strictly clamped to 0 in estimateMotorCurrent.
      if (thresholdV < openCircuitVoltageV) {
        candidateMotors.push({
          kMotor,
          iBemf: vBemf / rWinding,
          thresholdV,
        });
      }
    }
  }

  let gLoad = 0;
  let iBemf = 0;
  for (const m of candidateMotors) {
    gLoad += m.kMotor;
    iBemf += m.iBemf;
  }

  let vCandidate =
    gLoad <= 0 || internalResistanceOhm <= 0
      ? openCircuitVoltageV
      : (openCircuitVoltageV + iBemf * internalResistanceOhm) /
        (1 + gLoad * internalResistanceOhm);

  // Active-set consistency: check if heavy load from other motors pulled terminal voltage
  // below any candidate motor's threshold (turning it into an overspeed non-load)
  const trulyActive = candidateMotors.filter((m) => vCandidate > m.thresholdV);
  if (trulyActive.length < candidateMotors.length) {
    gLoad = 0;
    iBemf = 0;
    for (const m of trulyActive) {
      gLoad += m.kMotor;
      iBemf += m.iBemf;
    }
    vCandidate =
      gLoad <= 0 || internalResistanceOhm <= 0
        ? openCircuitVoltageV
        : (openCircuitVoltageV + iBemf * internalResistanceOhm) /
          (1 + gLoad * internalResistanceOhm);
  }

  const equilibriumTerminalV = Math.max(0, Math.min(openCircuitVoltageV, vCandidate));

  // Calculate actual total current at the equilibrium terminal voltage
  const currentDrawA = estimateTotalDriveCurrent(
    config.motors,
    leftThrottle,
    rightThrottle,
    leftOmega,
    rightOmega,
    equilibriumTerminalV
  );

  // Recalculate terminal voltage: V_terminal = max(0, V_oc - I * R_i)
  const terminalVoltageV = calculateBatteryTerminalVoltage(
    openCircuitVoltageV,
    currentDrawA,
    internalResistanceOhm
  );

  const voltageSagV = openCircuitVoltageV - terminalVoltageV;

  // Check low-voltage cutoff condition
  const isCutoff = enableCutoff && terminalVoltageV <= cutoffVoltageV;

  if (isCutoff) {
    return {
      openCircuitVoltageV,
      terminalVoltageV: 0,
      voltageSagV: openCircuitVoltageV,
      currentDrawA: 0,
      internalResistanceOhm,
      isCutoff: true,
      cutoffVoltageV,
      nominalVoltageV,
      assumptions: [rAssumption],
    };
  }

  return {
    openCircuitVoltageV,
    terminalVoltageV,
    voltageSagV,
    currentDrawA,
    internalResistanceOhm,
    isCutoff: false,
    cutoffVoltageV,
    nominalVoltageV,
    assumptions: [rAssumption],
  };
}
