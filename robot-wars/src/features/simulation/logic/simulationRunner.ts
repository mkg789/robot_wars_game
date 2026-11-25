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

/**
 * Creates an initial persistent SimulationRunnerState.
 */
export function createInitialRunnerState(
  config: SimulationRobotConfig,
  initialPose: { x?: number; z?: number; heading?: number } = {},
  options?: SimulationRunnerOptions
): SimulationRunnerState {
  const initialV = resolveBatteryOpenCircuitVoltage(config.battery, options?.battery);
  const initialState = createInitialSimulationState(initialPose, initialV);

  return {
    simulationState: {
      ...initialState,
      batteryTerminalVoltageV: initialV,
      isBatteryCutoff: false,
    },
    accumulatorSeconds: 0,
    isCutoff: false,
    totalSimulatedTimeSeconds: 0,
    totalPhysicsSteps: 0,
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
  wasCutoff = false
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
    wasCutoff
  );

  const isCutoff = batteryDiag.isCutoff;

  // 2. If cutoff is active, clamp motor commands to zero throttle and zero voltage
  const effectiveInput: DrivetrainInput = isCutoff
    ? { leftThrottle: 0, rightThrottle: 0 }
    : input;

  const operatingVoltageV = isCutoff ? 0 : batteryDiag.terminalVoltageV;
  const currentDrawA = isCutoff ? 0 : batteryDiag.currentDrawA;

  // 3. Step mechanical dynamics with voltage-scaled motor capabilities and spatial surface friction
  const dynamicsRes = stepDrivetrainDynamics(
    config,
    currentState,
    effectiveInput,
    fixedTimestepSeconds,
    operatingVoltageV,
    currentDrawA,
    options?.surface,
    options?.arena
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
    const batteryDiag = calculateBatteryOperatingPoint(
      config,
      currentRunnerState.simulationState,
      input,
      options?.battery,
      currentRunnerState.isCutoff
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
  let stepsExecuted = 0;
  const stepDiagnostics: DynamicsStepResult[] = [];

  let latestBatteryDiag = calculateBatteryOperatingPoint(
    config,
    currentState,
    input,
    options?.battery,
    isCutoff
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
      isCutoff
    );

    currentState = stepRes.state;
    isCutoff = stepRes.isCutoff;
    latestBatteryDiag = stepRes.batteryDiagnostics;
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
