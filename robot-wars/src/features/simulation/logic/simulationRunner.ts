/**
 * Pure Deterministic Simulation Runner for Robot Wars.
 *
 * Coordinates multi-step physics progression using a strictly fixed timestep,
 * integrates battery dynamics and voltage sag, and enforces low-voltage cutoff.
 *
 * Architecture & Design:
 * 1. Fixed Timestep (Default 1/120s = ~8.333 ms):
 *    Physics steps are ALWAYS executed with the exact configured fixed timestep.
 *    The physics engine is never invoked with arbitrary or varying frame durations.
 *
 * 2. Accumulator Remainder Strategy:
 *    When the caller requests an advance duration ΔT that is not an integer multiple of
 *    dt_fixed, the runner executes floor((accumulator + ΔT) / dt_fixed) steps.
 *    The remaining sub-step fraction is preserved in runnerState.accumulatorSeconds
 *    and consumed in subsequent calls. No physics steps are skipped or duplicated,
 *    and no floating-point accumulation drift is introduced.
 *
 * 3. Battery Voltage Sag Integration:
 *    At each sub-step, the electrical demand of all drive motors is evaluated, and the
 *    battery terminal voltage is solved via closed-form internal resistance drop.
 *    Motor stall torque and top speed scale with available terminal voltage.
 *
 * 4. Low-Voltage Cutoff Protection:
 *    When battery terminal voltage drops below cutoff threshold, power to motors is
 *    latched off (throttle clamped to 0, terminal voltage = 0 V).
 *
 * 5. Determinism & Purity:
 *    Zero side-effects, no timers, no asynchronous loops, no browser APIs.
 *    Completely decoupled from React, Three.js, Zustand, DOM, and UI rendering.
 */

import {
  calculateBatteryOperatingPoint,
  resolveBatteryOpenCircuitVoltage,
  type ElectricalRuntimeControl,
} from "./batteryDynamics";
import {
  deriveRobotCollisionEnvelope,
  detectArenaCollisions,
} from "./collisionModel";
import {
  resolveArenaCollisions,
  resolveCollisionResponseConfig,
} from "./collisionResponse";
import {
  createInitialSimulationState,
  stepDrivetrainDynamics,
} from "./drivetrainDynamics";
import type {
  BatteryDynamicsDiagnostics,
  CollisionResponseResult,
  DrivetrainInput,
  DynamicsStepResult,
  MotorRuntimeElectricalState,
  RuntimeElectricalState,
  SimulationAdvanceResult,
  SimulationRobotConfig,
  SimulationRunnerOptions,
  SimulationRunnerState,
  SimulationState,
} from "../types/simulation.types";

/**
 * Default fixed physics timestep (1/120 second = ~8.333 ms).
 */
export const DEFAULT_FIXED_TIMESTEP_SECONDS = 1 / 120;

/**
 * Maximum physics sub-steps permitted in a single advanceSimulation call
 * to guarantee safety against runaway loops or spiral of death.
 */
export const DEFAULT_MAX_SUB_STEPS = 120;

function buildInitialElectricalState(
  config: SimulationRobotConfig
): RuntimeElectricalState | undefined {
  const profile = config.electrical;
  if (!profile || profile.mode !== "electrical-connected") {
    return undefined;
  }
  const switchStates: Record<string, boolean> = {};
  for (const sw of profile.switches) {
    switchStates[sw.partId] = sw.defaultClosed;
  }
  const trippedFuseIds = profile.fuses
    .filter((f) => f.initialTripped)
    .map((f) => f.partId);

  return {
    switchStates,
    trippedFuseIds,
    totalMotorCurrentA: 0,
    totalAuxiliaryCurrentA: profile.auxiliaryLoadA,
    isBatteryDischargeLimited: false,
    activeFaults: [...profile.unmappedWarnings],
    motorStates: profile.motorPaths.map((mp) => ({
      motorId: mp.motorId,
      isPowered:
        mp.canEnergize &&
        !mp.hasCompileFault &&
        !mp.seriesSwitchIds.some((id) => switchStates[id] === false) &&
        !mp.seriesFuseIds.some((id) => trippedFuseIds.includes(id)),
      operatingVoltageV: 0,
      demandedCurrentA: 0,
      currentDrawA: 0,
      torqueScaleFactor: mp.canEnergize ? 1 : 0,
      isCurrentLimited: false,
      faultReason: mp.faultReason,
    })),
  };
}

export function buildUpdatedElectricalState(
  prev: RuntimeElectricalState | undefined,
  diag: BatteryDynamicsDiagnostics
): RuntimeElectricalState | undefined {
  if (!prev && !diag.perMotorStates && !diag.trippedFuseIds?.length) {
    return undefined;
  }
  return {
    switchStates: prev?.switchStates ?? {},
    trippedFuseIds: diag.trippedFuseIds ?? prev?.trippedFuseIds ?? [],
    totalMotorCurrentA: diag.totalMotorCurrentA ?? diag.currentDrawA,
    totalAuxiliaryCurrentA: diag.totalAuxiliaryCurrentA ?? 0,
    isBatteryDischargeLimited: Boolean(diag.isBatteryDischargeLimited),
    activeFaults: diag.activeElectricalFaults ?? [],
    motorStates: diag.perMotorStates ?? prev?.motorStates ?? [],
  };
}

/**
 * Sets a runtime switch state (closed/open) on a SimulationRunnerState cleanly
 * and optionally refreshes electrical/battery operating telemetry immediately.
 */
export function setSimulationSwitchState(
  runnerState: SimulationRunnerState,
  switchPartId: string,
  isClosed: boolean,
  config?: SimulationRobotConfig,
  options?: SimulationRunnerOptions
): SimulationRunnerState {
  const prevElec = runnerState.electricalState;
  if (!prevElec) return runnerState;
  const nextSwitchStates = {
    ...prevElec.switchStates,
    [switchPartId]: isClosed,
  };
  const baseRunner: SimulationRunnerState = {
    ...runnerState,
    electricalState: {
      ...prevElec,
      switchStates: nextSwitchStates,
    },
  };
  if (!config) return baseRunner;

  const diag = calculateBatteryOperatingPoint(
    config,
    runnerState.simulationState,
    { leftThrottle: 0, rightThrottle: 0 },
    options?.battery,
    runnerState.isCutoff,
    {
      switchStates: nextSwitchStates,
      trippedFuseIds: prevElec.trippedFuseIds,
    }
  );
  return {
    ...baseRunner,
    isCutoff: diag.isCutoff,
    simulationState: {
      ...runnerState.simulationState,
      batteryTerminalVoltageV: diag.terminalVoltageV,
      totalCurrentDrawA: diag.currentDrawA,
      isBatteryCutoff: diag.isCutoff,
    },
    electricalState: buildUpdatedElectricalState(baseRunner.electricalState, diag),
  };
}

/**
 * Clears runtime-tripped fuses on a SimulationRunnerState cleanly
 * and optionally refreshes electrical/battery operating telemetry immediately.
 */
export function resetSimulationFuses(
  runnerState: SimulationRunnerState,
  config?: SimulationRobotConfig,
  options?: SimulationRunnerOptions
): SimulationRunnerState {
  const prevElec = runnerState.electricalState;
  if (!prevElec) return runnerState;
  const baseRunner: SimulationRunnerState = {
    ...runnerState,
    electricalState: {
      ...prevElec,
      trippedFuseIds: [],
    },
  };
  if (!config) return baseRunner;

  const diag = calculateBatteryOperatingPoint(
    config,
    runnerState.simulationState,
    { leftThrottle: 0, rightThrottle: 0 },
    options?.battery,
    runnerState.isCutoff,
    {
      switchStates: prevElec.switchStates,
      trippedFuseIds: [],
    }
  );
  return {
    ...baseRunner,
    isCutoff: diag.isCutoff,
    simulationState: {
      ...runnerState.simulationState,
      batteryTerminalVoltageV: diag.terminalVoltageV,
      totalCurrentDrawA: diag.currentDrawA,
      isBatteryCutoff: diag.isCutoff,
    },
    electricalState: buildUpdatedElectricalState(baseRunner.electricalState, diag),
  };
}

/**
 * Creates an initial persistent SimulationRunnerState.
 */
export function createInitialRunnerState(
  config: SimulationRobotConfig,
  initialPose: { x?: number; z?: number; heading?: number } = {},
  options?: SimulationRunnerOptions
): SimulationRunnerState {
  const initialElec = buildInitialElectricalState(config);
  const initialBattDiag = calculateBatteryOperatingPoint(
    config,
    createInitialSimulationState(
      initialPose,
      resolveBatteryOpenCircuitVoltage(config.battery, options?.battery)
    ),
    { leftThrottle: 0, rightThrottle: 0 },
    options?.battery,
    false,
    initialElec
      ? {
          switchStates: initialElec.switchStates,
          trippedFuseIds: initialElec.trippedFuseIds,
        }
      : undefined
  );
  const initialV = initialBattDiag.terminalVoltageV;
  const initialState = createInitialSimulationState(initialPose, initialV);

  return {
    simulationState: {
      ...initialState,
      batteryTerminalVoltageV: initialV,
      totalCurrentDrawA: initialBattDiag.currentDrawA,
      isBatteryCutoff: initialBattDiag.isCutoff,
    },
    accumulatorSeconds: 0,
    isCutoff: initialBattDiag.isCutoff,
    totalSimulatedTimeSeconds: 0,
    totalPhysicsSteps: 0,
    electricalState: buildUpdatedElectricalState(initialElec, initialBattDiag),
  };
}

/**
 * Resets the low-voltage cutoff latch on a runner state.
 */
export function resetBatteryCutoff(
  runnerState: SimulationRunnerState
): SimulationRunnerState {
  return {
    ...runnerState,
    isCutoff: false,
    simulationState: {
      ...runnerState.simulationState,
      isBatteryCutoff: false,
    },
  };
}

/**
 * Executes exactly one fixed physics step coupled with battery dynamics.
 */
export function stepSimulationFixed(
  config: SimulationRobotConfig,
  currentState: SimulationState,
  input: DrivetrainInput,
  fixedTimestepSeconds: number,
  options?: SimulationRunnerOptions,
  wasCutoff = false,
  electricalControl?: ElectricalRuntimeControl
): {
  state: SimulationState;
  diagnostics: DynamicsStepResult;
  isCutoff: boolean;
  batteryDiagnostics: BatteryDynamicsDiagnostics;
} {
  // 1. Calculate battery operating point for this step
  if (options?.collisionResponse !== undefined) {
    resolveCollisionResponseConfig(options.collisionResponse);
  }

  const batteryDiag = calculateBatteryOperatingPoint(
    config,
    currentState,
    input,
    options?.battery,
    wasCutoff,
    electricalControl
  );

  const isCutoff = batteryDiag.isCutoff;

  // 2. If cutoff is active, clamp motor commands to zero throttle and zero voltage
  const effectiveInput: DrivetrainInput = isCutoff
    ? { leftThrottle: 0, rightThrottle: 0 }
    : input;

  const operatingVoltageV = isCutoff ? 0 : batteryDiag.terminalVoltageV;
  const currentDrawA = isCutoff ? 0 : batteryDiag.currentDrawA;

  const perMotorOverrides: Record<string, MotorRuntimeElectricalState> | undefined =
    batteryDiag.perMotorStates && batteryDiag.perMotorStates.length > 0
      ? Object.fromEntries(batteryDiag.perMotorStates.map((ms) => [ms.motorId, ms]))
      : undefined;

  // 3. Step mechanical dynamics with per-motor voltage/current capabilities and spatial surface friction
  const dynamicsRes = stepDrivetrainDynamics(
    config,
    currentState,
    effectiveInput,
    fixedTimestepSeconds,
    operatingVoltageV,
    currentDrawA,
    options?.surface,
    options?.arena,
    perMotorOverrides
  );

  // 4. Attach battery status to the post-drivetrain state
  const postDriveState: SimulationState = {
    ...dynamicsRes.state,
    batteryTerminalVoltageV: operatingVoltageV,
    totalCurrentDrawA: currentDrawA,
    isBatteryCutoff: isCutoff,
  };

  // 5. Optional planar collision detection & contact resolution against arena geometry
  let updatedState = postDriveState;
  let collisionResponse: CollisionResponseResult | undefined;

  if (options?.arena) {
    const envelope = deriveRobotCollisionEnvelope(
      config,
      {
        x: postDriveState.xMeters,
        z: postDriveState.zMeters,
        headingRadians: postDriveState.headingRadians,
      },
      options.robotFootprint
    );

    const collisionQuery = detectArenaCollisions(
      envelope,
      options.arena,
      options.collisionDetection
    );

    collisionResponse = resolveArenaCollisions(
      config,
      postDriveState,
      collisionQuery.collisions,
      options.collisionResponse
    );
    updatedState = collisionResponse.state;
  }

  return {
    state: updatedState,
    diagnostics:
      collisionResponse !== undefined
        ? {
            state: updatedState,
            diagnostics: dynamicsRes.diagnostics,
            collisionResponse,
          }
        : {
            state: updatedState,
            diagnostics: dynamicsRes.diagnostics,
          },
    isCutoff,
    batteryDiagnostics: batteryDiag,
  };
}

/**
 * Advances the simulation by a requested duration using a deterministic fixed timestep.
 *
 * Handles arbitrary requested durations via an accumulator remainder strategy:
 * - Executes as many fixed physics steps as fit within (accumulator + durationSeconds).
 * - Preserves the sub-step remainder in runnerState.accumulatorSeconds.
 * - Enforces maxSubSteps to prevent runaway execution.
 * - Pure and deterministic.
 */
export function advanceSimulation(
  config: SimulationRobotConfig,
  currentRunnerState: SimulationRunnerState,
  input: DrivetrainInput,
  durationSeconds: number,
  options?: SimulationRunnerOptions
): SimulationAdvanceResult {
  // 1. Validation & Safety
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error(
      `Invalid durationSeconds: must be a non-negative finite number, received: ${durationSeconds}`
    );
  }

  const fixedTimestep = options?.fixedTimestepSeconds ?? DEFAULT_FIXED_TIMESTEP_SECONDS;
  if (!Number.isFinite(fixedTimestep) || fixedTimestep <= 0) {
    throw new Error(
      `Invalid fixedTimestepSeconds: must be a positive finite number, received: ${fixedTimestep}`
    );
  }

  const maxSubSteps = options?.maxSubSteps ?? DEFAULT_MAX_SUB_STEPS;
  if (!Number.isFinite(maxSubSteps) || maxSubSteps <= 0) {
    throw new Error(
      `Invalid maxSubSteps: must be a positive finite number, received: ${maxSubSteps}`
    );
  }

  if (!input || !Number.isFinite(input.leftThrottle) || !Number.isFinite(input.rightThrottle)) {
    throw new Error(
      "Invalid drivetrain input: leftThrottle and rightThrottle must be finite numbers."
    );
  }

  if (!currentRunnerState || !currentRunnerState.simulationState) {
    throw new Error("Invalid currentRunnerState: runnerState must contain a valid simulationState.");
  }
  if (
    !Number.isFinite(currentRunnerState.accumulatorSeconds) ||
    currentRunnerState.accumulatorSeconds < 0
  ) {
    throw new Error(
      `Invalid currentRunnerState: accumulatorSeconds must be a non-negative finite number, received: ${currentRunnerState.accumulatorSeconds}`
    );
  }

  if (options?.collisionResponse !== undefined) {
    resolveCollisionResponseConfig(options.collisionResponse);
  }

  // 2. Fast-path: Zero duration request
  if (durationSeconds === 0) {
    const elecControl: ElectricalRuntimeControl | undefined =
      currentRunnerState.electricalState
        ? {
            switchStates: currentRunnerState.electricalState.switchStates,
            trippedFuseIds: currentRunnerState.electricalState.trippedFuseIds,
          }
        : undefined;
    const batteryDiag = calculateBatteryOperatingPoint(
      config,
      currentRunnerState.simulationState,
      input,
      options?.battery,
      currentRunnerState.isCutoff,
      elecControl
    );

    return {
      runnerState: currentRunnerState,
      durationRequestedSeconds: 0,
      timeAdvancedSeconds: 0,
      stepsExecuted: 0,
      fixedTimestepSeconds: fixedTimestep,
      accumulatorRemainderSeconds: currentRunnerState.accumulatorSeconds,
      batteryDiagnostics: batteryDiag,
      stepDiagnostics: [],
    };
  }

  // 3. Accumulator Loop
  let accumulator = currentRunnerState.accumulatorSeconds + durationSeconds;
  let currentState = currentRunnerState.simulationState;
  let isCutoff = currentRunnerState.isCutoff;
  let electricalState = currentRunnerState.electricalState;
  let stepsExecuted = 0;
  const stepDiagnostics: DynamicsStepResult[] = [];

  let latestBatteryDiag = calculateBatteryOperatingPoint(
    config,
    currentState,
    input,
    options?.battery,
    isCutoff,
    electricalState
      ? {
          switchStates: electricalState.switchStates,
          trippedFuseIds: electricalState.trippedFuseIds,
        }
      : undefined
  );

  // Epsilon threshold to handle floating-point precision at step boundaries
  const stepThreshold = fixedTimestep - 1e-9;

  while (accumulator >= stepThreshold && stepsExecuted < maxSubSteps) {
    const stepRes = stepSimulationFixed(
      config,
      currentState,
      input,
      fixedTimestep,
      options,
      isCutoff,
      electricalState
        ? {
            switchStates: electricalState.switchStates,
            trippedFuseIds: electricalState.trippedFuseIds,
          }
        : undefined
    );

    currentState = stepRes.state;
    isCutoff = stepRes.isCutoff;
    latestBatteryDiag = stepRes.batteryDiagnostics;
    electricalState = buildUpdatedElectricalState(electricalState, latestBatteryDiag);
    stepDiagnostics.push(stepRes.diagnostics);

    accumulator -= fixedTimestep;
    stepsExecuted++;
  }

  // Guard against micro-precision underflow
  if (accumulator < 1e-9) {
    accumulator = 0;
  }

  const timeAdvancedSeconds = stepsExecuted * fixedTimestep;

  const updatedRunnerState: SimulationRunnerState = {
    simulationState: currentState,
    accumulatorSeconds: accumulator,
    isCutoff,
    totalSimulatedTimeSeconds:
      currentRunnerState.totalSimulatedTimeSeconds + timeAdvancedSeconds,
    totalPhysicsSteps: currentRunnerState.totalPhysicsSteps + stepsExecuted,
    ...(electricalState && { electricalState }),
  };

  return {
    runnerState: updatedRunnerState,
    durationRequestedSeconds: durationSeconds,
    timeAdvancedSeconds,
    stepsExecuted,
    fixedTimestepSeconds: fixedTimestep,
    accumulatorRemainderSeconds: accumulator,
    batteryDiagnostics: latestBatteryDiag,
    stepDiagnostics,
  };
}
