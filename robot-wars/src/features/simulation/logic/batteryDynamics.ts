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
  CompiledElectricalRegulator,
  DrivetrainInput,
  MotorRuntimeElectricalState,
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
  options?: BatterySimulationOptions,
  battery?: BatterySimulationConfig | null
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

  if (
    battery?.internalResistanceOhm !== undefined &&
    Number.isFinite(battery.internalResistanceOhm) &&
    battery.internalResistanceOhm >= 0
  ) {
    return {
      resistanceOhm: battery.internalResistanceOhm,
      assumption: {
        id: "battery-spec-internal-resistance",
        parameter: "battery.internalResistanceOhm",
        value: battery.internalResistanceOhm,
        unit: "Ohms",
        source: "user-specified",
        description: `Compiled battery internal resistance of ${battery.internalResistanceOhm} Ω from battery electrical specification.`,
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
  // Use explicit datasheet/catalogue stall current when available; otherwise derive from torque constant
  const iStallNominal =
    motor.stallCurrentA !== undefined && motor.stallCurrentA > 0
      ? motor.stallCurrentA
      : motor.stallTorqueNm / kt;
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

export interface ElectricalRuntimeControl {
  readonly switchStates?: Readonly<Record<string, boolean>>;
  readonly trippedFuseIds?: readonly string[];
}

function resolveRegulatorStepVoltage(
  reg: CompiledElectricalRegulator,
  terminalVoltageV: number,
  switchStates: Readonly<Record<string, boolean>>,
  trippedFuseSet: ReadonlySet<string>
): { readonly isPowered: boolean; readonly outputVoltageV: number; readonly faultReason?: string } {
  const openSw = reg.seriesSwitchIds.find((id) => switchStates[id] === false);
  if (openSw) {
    return { isPowered: false, outputVoltageV: 0, faultReason: `Switch open upstream of ${reg.name}` };
  }
  const blownFuse = reg.seriesFuseIds.find((id) => trippedFuseSet.has(id));
  if (blownFuse) {
    return { isPowered: false, outputVoltageV: 0, faultReason: `Fuse tripped upstream of ${reg.name}` };
  }
  if (reg.hasCompileFault) {
    return { isPowered: false, outputVoltageV: 0, faultReason: `${reg.name} electrical configuration fault` };
  }
  if (reg.inputMaxV !== undefined && terminalVoltageV > reg.inputMaxV + 0.05) {
    return {
      isPowered: false,
      outputVoltageV: 0,
      faultReason: `${reg.name} input overvoltage (${terminalVoltageV.toFixed(1)}V > ${reg.inputMaxV.toFixed(1)}V max)`,
    };
  }
  if (reg.powerRole === "boost" && terminalVoltageV > reg.outputNominalV + 0.1) {
    return {
      isPowered: false,
      outputVoltageV: 0,
      faultReason: `Boost converter ${reg.name} input (${terminalVoltageV.toFixed(1)}V) exceeds setpoint (${reg.outputNominalV.toFixed(1)}V)`,
    };
  }
  if (
    (reg.powerRole === "buck" || reg.powerRole === "linear" || reg.powerRole === "bec") &&
    reg.dropoutVoltageV !== undefined &&
    terminalVoltageV < reg.outputNominalV + reg.dropoutVoltageV
  ) {
    // Regulator enters dropout brownout: output sags below nominal setpoint
    const saggedOutV = Math.max(0, terminalVoltageV - reg.dropoutVoltageV);
    return {
      isPowered: saggedOutV > 0.25,
      outputVoltageV: saggedOutV,
      faultReason: `${reg.name} in dropout (${saggedOutV.toFixed(1)}V < ${reg.outputNominalV.toFixed(1)}V)`,
    };
  }
  if (reg.inputMinV !== undefined && terminalVoltageV < reg.inputMinV - 0.05) {
    return {
      isPowered: false,
      outputVoltageV: 0,
      faultReason: `${reg.name} input undervoltage (${terminalVoltageV.toFixed(1)}V < ${reg.inputMinV.toFixed(1)}V)`,
    };
  }
  return { isPowered: true, outputVoltageV: reg.outputNominalV };
}

/**
 * Calculates a self-consistent battery operating point (terminal voltage, current, sag, cutoff,
 * and optional per-branch switch/fuse/regulator/driver electrical state).
 *
 * Solves the coupled circuit equilibrium between battery internal resistance,
 * motor electrical demand, motor-driver current limits, regulators/BECs, and auxiliary loads.
 */
export function calculateBatteryOperatingPoint(
  config: SimulationRobotConfig,
  state: SimulationState,
  input: DrivetrainInput,
  options?: BatterySimulationOptions,
  wasCutoff = false,
  electricalControl?: ElectricalRuntimeControl
): BatteryDynamicsDiagnostics {
  const batteryConfig = config.battery;
  const nominalVoltageV = batteryConfig?.nominalVoltageV ?? DEFAULT_BATTERY_NOMINAL_VOLTAGE_V;
  const openCircuitVoltageV = resolveBatteryOpenCircuitVoltage(batteryConfig, options);
  const cutoffVoltageV = resolveBatteryCutoffVoltage(batteryConfig, options);
  const { resistanceOhm: internalResistanceOhm, assumption: rAssumption } =
    resolveBatteryInternalResistance(options, batteryConfig);

  const enableCutoff = options?.enableCutoff ?? true;
  const profile = config.electrical;
  const switchStates: Record<string, boolean> = {};
  if (profile?.mode === "electrical-connected") {
    for (const sw of profile.switches) {
      switchStates[sw.partId] =
        electricalControl?.switchStates?.[sw.partId] ?? sw.defaultClosed;
    }
  }
  const initialTrippedFuseSet = new Set<string>(
    electricalControl?.trippedFuseIds ??
      (profile?.mode === "electrical-connected"
        ? profile.fuses.filter((f) => f.initialTripped).map((f) => f.partId)
        : [])
  );

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
      totalMotorCurrentA: 0,
      totalAuxiliaryCurrentA: 0,
      isBatteryDischargeLimited: false,
      trippedFuseIds: Array.from(initialTrippedFuseSet),
      perMotorStates: config.motors.map((m) => ({
        motorId: m.motorId,
        isPowered: false,
        operatingVoltageV: 0,
        demandedCurrentA: 0,
        currentDrawA: 0,
        torqueScaleFactor: 0,
        isCurrentLimited: false,
        faultReason: "Battery low-voltage cutoff latched",
      })),
      activeElectricalFaults: ["Battery low-voltage cutoff latched"],
      assumptions: [rAssumption],
    };
  }

  const leftThrottle = Math.max(-1.0, Math.min(1.0, input.leftThrottle));
  const rightThrottle = Math.max(-1.0, Math.min(1.0, input.rightThrottle));
  const leftOmega = state.leftWheelAngularVelocityRadPerSec;
  const rightOmega = state.rightWheelAngularVelocityRadPerSec;

  // Connected Electrical Profile Path: evaluates switches, fuses, regulators/BECs, drivers & auxiliary loads
  if (profile && profile.mode === "electrical-connected") {
    const regByPartId = new Map(profile.regulators.map((r) => [r.partId, r]));

    const evaluateAtTerminalVoltage = (vTerm: number) => {
      const regStates = new Map<string, ReturnType<typeof resolveRegulatorStepVoltage>>();
      for (const reg of profile.regulators) {
        regStates.set(
          reg.partId,
          resolveRegulatorStepVoltage(reg, vTerm, switchStates, initialTrippedFuseSet)
        );
      }

      const activeFaults: string[] = [];
      let totalAuxiliaryBatteryA = 0;
      const activeAuxOutByPart = new Map<string, number>();
      const activeAuxBatteryByPart = new Map<string, number>();

      interface ActiveAuxEval {
        readonly partId: string;
        readonly regulatorPartId?: string;
        readonly outCurrentA: number;
        readonly efficiencyRatio: number;
      }
      const activeAuxList: ActiveAuxEval[] = [];

      for (const aux of profile.auxiliaryLoads) {
        const swOpen = aux.seriesSwitchIds.some((id) => switchStates[id] === false);
        const fuseTripped = aux.seriesFuseIds.some((id) => initialTrippedFuseSet.has(id));
        if (swOpen || fuseTripped) continue;

        let efficiencyRatio = 1;
        if (aux.supplyKind === "regulated-rail" && aux.regulatorPartId) {
          const rState = regStates.get(aux.regulatorPartId);
          const regSpec = regByPartId.get(aux.regulatorPartId);
          if (!rState || !rState.isPowered || !regSpec) {
            if (rState?.faultReason) activeFaults.push(rState.faultReason);
            continue;
          }
          if (rState.faultReason) activeFaults.push(rState.faultReason);
          if (
            regSpec.powerRole !== "linear" &&
            regSpec.efficiency !== undefined &&
            regSpec.efficiency > 0 &&
            vTerm > 0.25
          ) {
            efficiencyRatio = rState.outputVoltageV / (vTerm * regSpec.efficiency);
          }
        }
        activeAuxList.push({
          partId: aux.partId,
          regulatorPartId:
            aux.supplyKind === "regulated-rail" ? aux.regulatorPartId : undefined,
          outCurrentA: aux.nominalCurrentA,
          efficiencyRatio,
        });
      }

      // Add regulator quiescent draw when enabled
      for (const reg of profile.regulators) {
        if (reg.quiescentCurrentA <= 0) continue;
        const rState = regStates.get(reg.partId);
        if (rState?.isPowered) {
          totalAuxiliaryBatteryA += reg.quiescentCurrentA;
        }
      }

      interface DraftMotorEval {
        readonly motorId: string;
        readonly isPowered: boolean;
        readonly operatingVoltageV: number;
        readonly demandedCurrentA: number;
        readonly clampedMotorCurrentA: number;
        readonly regulatorEfficiencyRatio: number;
        readonly batterySideCurrentA: number;
        readonly torqueScaleFactor: number;
        readonly isCurrentLimited: boolean;
        readonly faultReason?: string;
        readonly supplyKind: "unregulated-battery" | "regulated-rail" | "unpowered";
        readonly regulatorPartId?: string;
        readonly seriesFuseIds: readonly string[];
      }

      const rawDraftMotors: DraftMotorEval[] = [];

      for (const motor of config.motors) {
        const mPath = profile.motorPaths.find((mp) => mp.motorId === motor.motorId);
        if (!mPath || !mPath.hasElectricalPath) {
          const reason = mPath?.faultReason ?? `Motor "${motor.name}" is unwired.`;
          activeFaults.push(reason);
          rawDraftMotors.push({
            motorId: motor.motorId,
            isPowered: false,
            operatingVoltageV: 0,
            demandedCurrentA: 0,
            clampedMotorCurrentA: 0,
            regulatorEfficiencyRatio: 1,
            batterySideCurrentA: 0,
            torqueScaleFactor: 0,
            isCurrentLimited: false,
            faultReason: reason,
            supplyKind: "unpowered",
            seriesFuseIds: [],
          });
          continue;
        }

        const openSw = mPath.seriesSwitchIds.find((id) => switchStates[id] === false);
        if (openSw) {
          const swName = profile.switches.find((s) => s.partId === openSw)?.name ?? openSw;
          const reason = `Switch "${swName}" open`;
          activeFaults.push(reason);
          rawDraftMotors.push({
            motorId: motor.motorId,
            isPowered: false,
            operatingVoltageV: 0,
            demandedCurrentA: 0,
            clampedMotorCurrentA: 0,
            regulatorEfficiencyRatio: 1,
            batterySideCurrentA: 0,
            torqueScaleFactor: 0,
            isCurrentLimited: false,
            faultReason: reason,
            supplyKind: mPath.supplyKind,
            regulatorPartId: mPath.regulatorPartId,
            seriesFuseIds: mPath.seriesFuseIds,
          });
          continue;
        }

        const trippedFuse = mPath.seriesFuseIds.find((id) =>
          initialTrippedFuseSet.has(id)
        );
        if (trippedFuse) {
          const fuseName =
            profile.fuses.find((f) => f.partId === trippedFuse)?.name ?? trippedFuse;
          const reason = `Fuse "${fuseName}" tripped`;
          activeFaults.push(reason);
          rawDraftMotors.push({
            motorId: motor.motorId,
            isPowered: false,
            operatingVoltageV: 0,
            demandedCurrentA: 0,
            clampedMotorCurrentA: 0,
            regulatorEfficiencyRatio: 1,
            batterySideCurrentA: 0,
            torqueScaleFactor: 0,
            isCurrentLimited: false,
            faultReason: reason,
            supplyKind: mPath.supplyKind,
            regulatorPartId: mPath.regulatorPartId,
            seriesFuseIds: mPath.seriesFuseIds,
          });
          continue;
        }

        if (mPath.hasCompileFault || !mPath.canEnergize) {
          const reason = mPath.faultReason ?? `Motor "${motor.name}" electrical path fault`;
          activeFaults.push(reason);
          rawDraftMotors.push({
            motorId: motor.motorId,
            isPowered: false,
            operatingVoltageV: 0,
            demandedCurrentA: 0,
            clampedMotorCurrentA: 0,
            regulatorEfficiencyRatio: 1,
            batterySideCurrentA: 0,
            torqueScaleFactor: 0,
            isCurrentLimited: false,
            faultReason: reason,
            supplyKind: mPath.supplyKind,
            regulatorPartId: mPath.regulatorPartId,
            seriesFuseIds: mPath.seriesFuseIds,
          });
          continue;
        }

        let supplyVoltageV = vTerm;
        let regulatorEfficiencyRatio = 1;
        if (mPath.supplyKind === "regulated-rail" && mPath.regulatorPartId) {
          const rState = regStates.get(mPath.regulatorPartId);
          const regSpec = regByPartId.get(mPath.regulatorPartId);
          if (!rState || !rState.isPowered) {
            const reason = rState?.faultReason ?? `Regulator off for motor "${motor.name}"`;
            activeFaults.push(reason);
            rawDraftMotors.push({
              motorId: motor.motorId,
              isPowered: false,
              operatingVoltageV: 0,
              demandedCurrentA: 0,
              clampedMotorCurrentA: 0,
              regulatorEfficiencyRatio: 1,
              batterySideCurrentA: 0,
              torqueScaleFactor: 0,
              isCurrentLimited: false,
              faultReason: reason,
              supplyKind: mPath.supplyKind,
              regulatorPartId: mPath.regulatorPartId,
              seriesFuseIds: mPath.seriesFuseIds,
            });
            continue;
          }
          if (rState.faultReason) activeFaults.push(rState.faultReason);
          supplyVoltageV = rState.outputVoltageV;
          if (
            regSpec &&
            regSpec.powerRole !== "linear" &&
            regSpec.efficiency !== undefined &&
            regSpec.efficiency > 0 &&
            vTerm > 0.25
          ) {
            regulatorEfficiencyRatio =
              supplyVoltageV / (vTerm * regSpec.efficiency);
          }
        }

        const throttle = motor.side === "left" ? leftThrottle : rightThrottle;
        const omega = motor.side === "left" ? leftOmega : rightOmega;
        const demandedCurrentA = estimateMotorCurrent(
          motor,
          throttle,
          omega,
          supplyVoltageV
        );

        const driverLimitA =
          mPath.driverContinuousCurrentA ?? mPath.driverPeakCurrentA;
        let clampedMotorCurrentA = demandedCurrentA;
        let torqueScaleFactor = 1.0;
        let isCurrentLimited = false;

        if (
          driverLimitA !== undefined &&
          driverLimitA > 0 &&
          demandedCurrentA > driverLimitA
        ) {
          clampedMotorCurrentA = driverLimitA;
          torqueScaleFactor = driverLimitA / demandedCurrentA;
          isCurrentLimited = true;
        }

        rawDraftMotors.push({
          motorId: motor.motorId,
          isPowered: true,
          operatingVoltageV: supplyVoltageV,
          demandedCurrentA,
          clampedMotorCurrentA,
          regulatorEfficiencyRatio,
          batterySideCurrentA: clampedMotorCurrentA * regulatorEfficiencyRatio,
          torqueScaleFactor,
          isCurrentLimited,
          supplyKind: mPath.supplyKind,
          regulatorPartId: mPath.regulatorPartId,
          seriesFuseIds: mPath.seriesFuseIds,
        });
      }

      // Enforce regulator/BEC continuous output current limits in the regulated load domain
      const regAuxScaleMap = new Map<string, number>();
      const regMotorScaleMap = new Map<string, number>();
      for (const reg of profile.regulators) {
        if (reg.maxOutputCurrentA === undefined || reg.maxOutputCurrentA <= 0) continue;
        const rState = regStates.get(reg.partId);
        if (!rState?.isPowered) continue;

        let regAuxOutA = 0;
        for (const a of activeAuxList) {
          if (a.regulatorPartId === reg.partId) regAuxOutA += a.outCurrentA;
        }
        let regMotorOutA = 0;
        for (const dm of rawDraftMotors) {
          if (dm.isPowered && dm.regulatorPartId === reg.partId) {
            regMotorOutA += dm.clampedMotorCurrentA;
          }
        }
        const totalRegOutA = regAuxOutA + regMotorOutA;
        if (totalRegOutA > reg.maxOutputCurrentA + 1e-6) {
          activeFaults.push(
            `${reg.name} output current limited (${totalRegOutA.toFixed(1)}A > ${reg.maxOutputCurrentA.toFixed(1)}A max)`
          );
          if (regAuxOutA >= reg.maxOutputCurrentA) {
            regAuxScaleMap.set(reg.partId, reg.maxOutputCurrentA / regAuxOutA);
            regMotorScaleMap.set(reg.partId, 0);
          } else {
            regAuxScaleMap.set(reg.partId, 1.0);
            if (regMotorOutA > 0) {
              regMotorScaleMap.set(
                reg.partId,
                (reg.maxOutputCurrentA - regAuxOutA) / regMotorOutA
              );
            }
          }
        }
      }

      for (const aux of activeAuxList) {
        const regScale = aux.regulatorPartId
          ? (regAuxScaleMap.get(aux.regulatorPartId) ?? 1.0)
          : 1.0;
        const clampedOutA = aux.outCurrentA * regScale;
        const batterySideA = clampedOutA * aux.efficiencyRatio;
        activeAuxOutByPart.set(aux.partId, clampedOutA);
        activeAuxBatteryByPart.set(aux.partId, batterySideA);
        totalAuxiliaryBatteryA += batterySideA;
      }

      let totalMotorBatteryA = 0;
      const draftMotors: DraftMotorEval[] = rawDraftMotors.map((dm) => {
        if (!dm.isPowered) return dm;
        const regScale = dm.regulatorPartId
          ? (regMotorScaleMap.get(dm.regulatorPartId) ?? 1.0)
          : 1.0;
        if (regScale >= 1.0 - 1e-9) {
          totalMotorBatteryA += dm.batterySideCurrentA;
          return dm;
        }
        const clampedMotorCurrentA = dm.clampedMotorCurrentA * regScale;
        const batterySideCurrentA =
          clampedMotorCurrentA * dm.regulatorEfficiencyRatio;
        totalMotorBatteryA += batterySideCurrentA;
        return {
          ...dm,
          clampedMotorCurrentA,
          batterySideCurrentA,
          torqueScaleFactor: dm.torqueScaleFactor * regScale,
          isCurrentLimited: true,
        };
      });

      // Enforce explicit battery continuous discharge rating if defined in specification
      let isBatteryDischargeLimited = false;
      let batteryScale = 1.0;
      const maxBattA = batteryConfig?.maxContinuousDischargeA;
      const rawTotalCurrentA = totalMotorBatteryA + totalAuxiliaryBatteryA;
      if (
        maxBattA !== undefined &&
        maxBattA > 0 &&
        rawTotalCurrentA > maxBattA &&
        totalMotorBatteryA > 0
      ) {
        isBatteryDischargeLimited = true;
        const motorHeadroom = Math.max(0, maxBattA - totalAuxiliaryBatteryA);
        batteryScale = Math.max(0, Math.min(1, motorHeadroom / totalMotorBatteryA));
      }

      const finalMotorStates: MotorRuntimeElectricalState[] = [];
      let scaledMotorBatteryA = 0;

      for (const dm of draftMotors) {
        if (!dm.isPowered) {
          finalMotorStates.push({
            motorId: dm.motorId,
            isPowered: false,
            operatingVoltageV: 0,
            demandedCurrentA: 0,
            currentDrawA: 0,
            torqueScaleFactor: 0,
            isCurrentLimited: false,
            faultReason: dm.faultReason,
          });
        } else {
          const finalBatteryI = dm.batterySideCurrentA * batteryScale;
          scaledMotorBatteryA += finalBatteryI;
          finalMotorStates.push({
            motorId: dm.motorId,
            isPowered: true,
            operatingVoltageV: dm.operatingVoltageV,
            demandedCurrentA: dm.demandedCurrentA,
            currentDrawA: dm.clampedMotorCurrentA * batteryScale,
            torqueScaleFactor: dm.torqueScaleFactor * batteryScale,
            isCurrentLimited: dm.isCurrentLimited || isBatteryDischargeLimited,
          });
        }
      }

      const totalCurrentA = scaledMotorBatteryA + totalAuxiliaryBatteryA;
      return {
        totalCurrentA,
        totalMotorBatteryA: scaledMotorBatteryA,
        totalAuxiliaryBatteryA,
        isBatteryDischargeLimited,
        finalMotorStates,
        draftMotors,
        batteryScale,
        regStates,
        activeAuxOutByPart,
        activeAuxBatteryByPart,
        activeFaults: Array.from(new Set(activeFaults)),
      };
    };

    // Damped fixed-point solver converges cleanly for nonlinear clamps and regulated loads
    let vSolved = openCircuitVoltageV;
    let evalResult = evaluateAtTerminalVoltage(vSolved);
    for (let iter = 0; iter < 6; iter++) {
      const vNext = calculateBatteryTerminalVoltage(
        openCircuitVoltageV,
        evalResult.totalCurrentA,
        internalResistanceOhm
      );
      if (Math.abs(vNext - vSolved) < 1e-5) {
        break;
      }
      vSolved = 0.5 * vSolved + 0.5 * vNext;
      evalResult = evaluateAtTerminalVoltage(vSolved);
    }

    const terminalVoltageV = calculateBatteryTerminalVoltage(
      openCircuitVoltageV,
      evalResult.totalCurrentA,
      internalResistanceOhm
    );
    evalResult = evaluateAtTerminalVoltage(terminalVoltageV);
    const voltageSagV = openCircuitVoltageV - terminalVoltageV;
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
        totalMotorCurrentA: 0,
        totalAuxiliaryCurrentA: 0,
        isBatteryDischargeLimited: false,
        trippedFuseIds: Array.from(initialTrippedFuseSet),
        perMotorStates: config.motors.map((m) => ({
          motorId: m.motorId,
          isPowered: false,
          operatingVoltageV: 0,
          demandedCurrentA: 0,
          currentDrawA: 0,
          torqueScaleFactor: 0,
          isCurrentLimited: false,
          faultReason: "Battery low-voltage cutoff",
        })),
        activeElectricalFaults: ["Battery low-voltage cutoff"],
        assumptions: [rAssumption],
      };
    }

    // Check deterministic overcurrent fuse tripping across active fuses in each fuse's local electrical domain
    const nextTrippedFuseSet = new Set(initialTrippedFuseSet);
    for (const fuse of profile.fuses) {
      if (nextTrippedFuseSet.has(fuse.partId)) continue;
      let branchCurrentA = 0;
      for (const dm of evalResult.draftMotors) {
        if (dm.isPowered && dm.seriesFuseIds.includes(fuse.partId)) {
          const regSpec = dm.regulatorPartId
            ? regByPartId.get(dm.regulatorPartId)
            : undefined;
          const isDownstreamOfRegulator = Boolean(
            dm.supplyKind === "regulated-rail" &&
              regSpec &&
              !regSpec.seriesFuseIds.includes(fuse.partId)
          );
          branchCurrentA += isDownstreamOfRegulator
            ? dm.clampedMotorCurrentA * evalResult.batteryScale
            : dm.batterySideCurrentA * evalResult.batteryScale;
        }
      }
      for (const aux of profile.auxiliaryLoads) {
        if (aux.seriesFuseIds.includes(fuse.partId)) {
          const regSpec = aux.regulatorPartId
            ? regByPartId.get(aux.regulatorPartId)
            : undefined;
          const isDownstreamOfRegulator = Boolean(
            aux.supplyKind === "regulated-rail" &&
              regSpec &&
              !regSpec.seriesFuseIds.includes(fuse.partId)
          );
          branchCurrentA += isDownstreamOfRegulator
            ? (evalResult.activeAuxOutByPart.get(aux.partId) ?? 0)
            : (evalResult.activeAuxBatteryByPart.get(aux.partId) ?? 0);
        }
      }
      for (const reg of profile.regulators) {
        if (
          reg.quiescentCurrentA > 0 &&
          reg.seriesFuseIds.includes(fuse.partId) &&
          evalResult.regStates.get(reg.partId)?.isPowered
        ) {
          branchCurrentA += reg.quiescentCurrentA;
        }
      }
      if (branchCurrentA > fuse.ratedCurrentA + 1e-6) {
        nextTrippedFuseSet.add(fuse.partId);
        evalResult.activeFaults.push(
          `Fuse "${fuse.name}" tripped (${branchCurrentA.toFixed(1)}A > ${fuse.ratedCurrentA.toFixed(1)}A)`
        );
      }
    }

    return {
      openCircuitVoltageV,
      terminalVoltageV,
      voltageSagV,
      currentDrawA: evalResult.totalCurrentA,
      internalResistanceOhm,
      isCutoff: false,
      cutoffVoltageV,
      nominalVoltageV,
      totalMotorCurrentA: evalResult.totalMotorBatteryA,
      totalAuxiliaryCurrentA: evalResult.totalAuxiliaryBatteryA,
      isBatteryDischargeLimited: evalResult.isBatteryDischargeLimited,
      trippedFuseIds: Array.from(nextTrippedFuseSet),
      perMotorStates: evalResult.finalMotorStates,
      activeElectricalFaults: Array.from(new Set(evalResult.activeFaults)),
      assumptions: [rAssumption],
    };
  }

  // Legacy Mechanical-Only Closed-Form Path (zero electricalConnections present)

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
  const rawCurrentDrawA = estimateTotalDriveCurrent(
    config.motors,
    leftThrottle,
    rightThrottle,
    leftOmega,
    rightOmega,
    equilibriumTerminalV
  );

  const maxBattA = batteryConfig?.maxContinuousDischargeA;
  const isBatteryDischargeLimited =
    maxBattA !== undefined && maxBattA > 0 && rawCurrentDrawA > maxBattA;
  const currentDrawA = isBatteryDischargeLimited
    ? maxBattA
    : rawCurrentDrawA;

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
      isBatteryDischargeLimited: false,
      assumptions: [rAssumption],
    };
  }

  const batteryScale =
    isBatteryDischargeLimited && rawCurrentDrawA > 0
      ? currentDrawA / rawCurrentDrawA
      : 1.0;

  return {
    openCircuitVoltageV,
    terminalVoltageV,
    voltageSagV,
    currentDrawA,
    internalResistanceOhm,
    isCutoff: false,
    cutoffVoltageV,
    nominalVoltageV,
    totalMotorCurrentA: currentDrawA,
    totalAuxiliaryCurrentA: 0,
    isBatteryDischargeLimited,
    ...(isBatteryDischargeLimited && {
      perMotorStates: config.motors.map((m) => {
        const throttle = m.side === "left" ? leftThrottle : rightThrottle;
        const omega = m.side === "left" ? leftOmega : rightOmega;
        const demandedA = estimateMotorCurrent(m, throttle, omega, terminalVoltageV);
        return {
          motorId: m.motorId,
          isPowered: true,
          operatingVoltageV: terminalVoltageV,
          demandedCurrentA: demandedA,
          currentDrawA: demandedA * batteryScale,
          torqueScaleFactor: batteryScale,
          isCurrentLimited: true,
        };
      }),
    }),
    assumptions: [rAssumption],
  };
}
