/**
 * Simulation World Orchestration Layer for Robot Wars (Phase 4.2).
 *
 * Coordinates:
 * - Compiled SimulationRobotConfig (compiled once per session).
 * - ArenaConfig geometry and presets.
 * - Fixed-timestep SimulationRunnerState progression via advanceSimulation.
 * - Lifecycle state machine (ready, running, paused, error) and deterministic reset.
 * - Directional drive control mapping and focus-safe input clearing.
 * - Read-only render poses, collision diagnostics, and telemetry snapshots.
 *
 * Completely decoupled from React, Three.js, Zustand, and DOM APIs so the
 * entire simulation orchestration can be tested headlessly.
 */

import type {
  DrivetrainConfiguration,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../../robot-builder/types/robot.types";
import type { ArenaConfig } from "../types/arena.types";
import type {
  CollisionResponseResult,
  DrivetrainInput,
  DynamicsStepResult,
  SimulationAdvanceResult,
  SimulationRobotConfig,
  SimulationRunnerOptions,
  SimulationRunnerState,
  SimulationState,
} from "../types/simulation.types";
import type {
  SimulationArenaPreset,
  SimulationCollisionSnapshot,
  SimulationDriveControls,
  SimulationLifecycleStatus,
  SimulationRenderPose,
  SimulationTelemetrySnapshot,
  SimulationWorldDiagnostics,
  SimulationWorldInitResult,
  SimulationWorldOptions,
} from "../types/simulationWorld.types";
import {
  createRectangularArena,
  createRectangularSurfaceZone,
  STANDARD_ROBOT_WARS_ARENA,
  validateArena,
} from "./arenaModel";
import { resolveCollisionResponseConfig } from "./collisionResponse";
import { compileSimulationConfig } from "./simulationConfigCompiler";
import {
  advanceSimulation,
  createInitialRunnerState,
  DEFAULT_FIXED_TIMESTEP_SECONDS,
} from "./simulationRunner";

/**
 * Default maximum frame delta passed into advanceSimulation per render tick (100 ms)
 * to avoid spiral-of-death catchup bursts after browser tab switching.
 */
export const DEFAULT_MAX_FRAME_DELTA_SECONDS = 0.1;

/**
 * Neutral zero-input drive control state.
 */
export const NEUTRAL_DRIVE_CONTROLS: SimulationDriveControls = Object.freeze({
  forward: false,
  reverse: false,
  left: false,
  right: false,
});

/**
 * Neutral zero-throttle drivetrain input.
 */
export const NEUTRAL_DRIVETRAIN_INPUT: DrivetrainInput = Object.freeze({
  leftThrottle: 0,
  rightThrottle: 0,
});

/**
 * Empty collision indicator snapshot.
 */
export const EMPTY_COLLISION_SNAPSHOT: SimulationCollisionSnapshot = Object.freeze({
  hasCollision: false,
  contactCount: 0,
  collidedBarrierIds: [],
  totalNormalImpulseNs: 0,
  maxPenetrationDepthM: 0,
});

/**
 * Arena with interior rectangular obstacles and a localized low-grip surface zone
 * derived strictly from canonical ArenaConfig contracts.
 */
export const OBSTACLE_TEST_ARENA: ArenaConfig = Object.freeze(
  createRectangularArena({
    id: "obstacle-test-arena-12x12",
    name: "Obstacle Arena (12m × 12m)",
    description:
      "12m × 12m steel arena with interior rectangular barriers and a low-grip hazard zone for collision and traction testing.",
    lengthM: 12.0,
    widthM: 12.0,
    heightM: 4.0,
    wallThicknessM: 0.2,
    wallHeightM: 0.9,
    barriers: [
      {
        id: "barrier-north-pillar",
        name: "North Center Pillar",
        isPerimeter: false,
        geometryType: "rectangle",
        position: { x: 2.8, z: 0 },
        sizeX: 0.9,
        sizeZ: 1.6,
        heightM: 0.75,
      },
      {
        id: "barrier-west-block",
        name: "West Angled Block",
        isPerimeter: false,
        geometryType: "rectangle",
        position: { x: -2.4, z: 2.4 },
        sizeX: 1.4,
        sizeZ: 0.9,
        heightM: 0.75,
      },
      {
        id: "barrier-east-rail",
        name: "East Deflector Rail",
        isPerimeter: false,
        geometryType: "rectangle",
        position: { x: 0.4, z: -2.9 },
        sizeX: 2.2,
        sizeZ: 0.6,
        heightM: 0.75,
      },
    ],
    surfaceZones: [
      createRectangularSurfaceZone({
        id: "zone-low-grip-spill",
        name: "Low-Grip Spill Zone",
        center: { x: -2.4, z: -2.2 },
        sizeX: 2.6,
        sizeZ: 2.6,
        surface: "low-grip",
        priority: 1,
      }),
    ],
  })
);

/**
 * Built-in selectable arena presets for the interactive simulation environment.
 */
export const SIMULATION_ARENA_PRESETS: readonly SimulationArenaPreset[] = Object.freeze([
  {
    id: OBSTACLE_TEST_ARENA.id,
    name: OBSTACLE_TEST_ARENA.name,
    description: OBSTACLE_TEST_ARENA.description ?? "",
    arena: OBSTACLE_TEST_ARENA,
  },
  {
    id: STANDARD_ROBOT_WARS_ARENA.id,
    name: STANDARD_ROBOT_WARS_ARENA.name,
    description: STANDARD_ROBOT_WARS_ARENA.description ?? "",
    arena: STANDARD_ROBOT_WARS_ARENA,
  },
]);

function clampThrottle(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Maps directional keyboard/button controls into differential-drive left/right throttle commands.
 *
 * Coordinate sign convention:
 * - Positive yaw turns LEFT (+Z).
 * - Net yaw torque τ = (w/2) * (F_right - F_left).
 * - Turning left requires rightThrottle > leftThrottle.
 */
export function mapDriveControlsToDrivetrainInput(
  controls: SimulationDriveControls
): DrivetrainInput {
  const throttle = (controls.forward ? 1 : 0) - (controls.reverse ? 1 : 0);
  const turn = (controls.left ? 1 : 0) - (controls.right ? 1 : 0);

  if (throttle === 0 && turn === 0) {
    return NEUTRAL_DRIVETRAIN_INPUT;
  }

  return {
    leftThrottle: clampThrottle(throttle - turn),
    rightThrottle: clampThrottle(throttle + turn),
  };
}

/**
 * Extracts a read-only collision indicator snapshot from a collision response diagnostic.
 */
export function buildCollisionSnapshot(
  collisionResponse?: CollisionResponseResult
): SimulationCollisionSnapshot {
  if (!collisionResponse || !collisionResponse.hasCollisions) {
    return EMPTY_COLLISION_SNAPSHOT;
  }

  const collidedBarrierIds = Array.from(
    new Set(collisionResponse.contacts.map((c) => c.barrierId))
  );
  let maxPenetrationDepthM = 0;
  for (const contact of collisionResponse.contacts) {
    if (contact.penetrationDepthM > maxPenetrationDepthM) {
      maxPenetrationDepthM = contact.penetrationDepthM;
    }
  }

  return {
    hasCollision: true,
    contactCount: collisionResponse.contactCount,
    collidedBarrierIds,
    totalNormalImpulseNs: collisionResponse.totalNormalImpulseNs,
    maxPenetrationDepthM,
  };
}

/**
 * Builds a read-only SimulationTelemetrySnapshot strictly from existing simulation state
 * and collision diagnostics without fabricating unavailable fields.
 */
export function buildTelemetrySnapshot(
  lifecycleStatus: SimulationLifecycleStatus,
  state: SimulationState,
  collision: SimulationCollisionSnapshot
): SimulationTelemetrySnapshot {
  const radToDeg = 180 / Math.PI;
  return {
    lifecycleStatus,
    timeSeconds: state.timeSeconds,
    stepCount: state.stepCount,
    xMeters: state.xMeters,
    zMeters: state.zMeters,
    headingRadians: state.headingRadians,
    headingDegrees: state.headingRadians * radToDeg,
    longitudinalVelocityMps: state.longitudinalVelocityMps,
    lateralVelocityMps: state.lateralVelocityMps,
    yawRateRadPerSec: state.yawRateRadPerSec,
    yawRateDegPerSec: state.yawRateRadPerSec * radToDeg,
    longitudinalAccelerationMps2: state.longitudinalAccelerationMps2,
    angularAccelerationRadPerSec2: state.angularAccelerationRadPerSec2,
    batteryTerminalVoltageV: state.batteryTerminalVoltageV,
    totalCurrentDrawA: state.totalCurrentDrawA,
    isBatteryCutoff: Boolean(state.isBatteryCutoff),
    collision,
  };
}

function validateCompiledRobotConfigForWorld(config: SimulationRobotConfig): string[] {
  const errors: string[] = [];
  if (!config || typeof config !== "object") {
    return ["Compiled robot configuration is missing."];
  }
  if (config.validity === "invalid") {
    errors.push("Compiled robot configuration is marked invalid.");
  }
  if (!Number.isFinite(config.totalMassKg) || config.totalMassKg <= 0) {
    errors.push(`Invalid robot totalMassKg: ${config.totalMassKg}.`);
  }
  if (!Number.isFinite(config.yawInertiaKgM2) || config.yawInertiaKgM2 <= 0) {
    errors.push(`Invalid robot yawInertiaKgM2: ${config.yawInertiaKgM2}.`);
  }
  if (!Number.isFinite(config.trackWidthM) || config.trackWidthM <= 0) {
    errors.push(`Invalid robot trackWidthM: ${config.trackWidthM}.`);
  }
  if (!config.motors || config.motors.length === 0) {
    errors.push("Compiled robot has no configured drive motors.");
  }
  if (!config.wheels || config.wheels.length === 0) {
    errors.push("Compiled robot has no configured drive wheels.");
  }
  return errors;
}

export type SimulationWorldListener = (status: SimulationLifecycleStatus) => void;

/**
 * Application-level orchestrator managing a single interactive planar simulation session.
 */
export class SimulationWorld {
  private readonly robotConfig: SimulationRobotConfig;
  private readonly initialPose: { readonly x?: number; readonly z?: number; readonly heading?: number };
  private readonly maxFrameDeltaSeconds: number;
  private arena: ArenaConfig;
  private runnerOptions: SimulationRunnerOptions;
  private runnerState: SimulationRunnerState;
  private lifecycleStatus: SimulationLifecycleStatus = "ready";
  private activeControls: SimulationDriveControls = NEUTRAL_DRIVE_CONTROLS;
  private activeInput: DrivetrainInput = NEUTRAL_DRIVETRAIN_INPUT;
  private latestCollision: SimulationCollisionSnapshot = EMPTY_COLLISION_SNAPSHOT;
  private latestStepDiagnostics: DynamicsStepResult | null = null;
  private lastError: string | null = null;
  private readonly listeners = new Set<SimulationWorldListener>();

  constructor(options: SimulationWorldOptions) {
    if (!options || typeof options !== "object") {
      throw new Error("SimulationWorld requires valid initialization options.");
    }

    const robotErrors = validateCompiledRobotConfigForWorld(options.robotConfig);
    if (robotErrors.length > 0) {
      throw new Error(`Invalid robot configuration: ${robotErrors.join("; ")}`);
    }

    const arenaValidation = validateArena(options.arena);
    if (!arenaValidation.isValid) {
      throw new Error(`Invalid arena configuration: ${arenaValidation.errors.join("; ")}`);
    }

    if (options.collisionResponse !== undefined) {
      resolveCollisionResponseConfig(options.collisionResponse);
    }

    const maxDelta = options.maxFrameDeltaSeconds ?? DEFAULT_MAX_FRAME_DELTA_SECONDS;
    if (!Number.isFinite(maxDelta) || maxDelta <= 0) {
      throw new Error(
        `Invalid maxFrameDeltaSeconds: must be a positive finite number, received: ${maxDelta}`
      );
    }

    this.robotConfig = options.robotConfig;
    this.arena = options.arena;
    this.initialPose = {
      x: options.initialPose?.x ?? 0,
      z: options.initialPose?.z ?? 0,
      heading: options.initialPose?.heading ?? 0,
    };
    this.maxFrameDeltaSeconds = maxDelta;
    this.runnerOptions = {
      ...options.runnerOptions,
      fixedTimestepSeconds:
        options.runnerOptions?.fixedTimestepSeconds ?? DEFAULT_FIXED_TIMESTEP_SECONDS,
      arena: options.arena,
      collisionResponse: options.collisionResponse,
    };
    this.runnerState = createInitialRunnerState(
      this.robotConfig,
      this.initialPose,
      this.runnerOptions
    );
  }

  /**
   * Compiles assembly data once and creates a validated SimulationWorld, returning errors
   * gracefully instead of throwing when assembly or arena validation fails.
   */
  static fromAssembly(params: {
    readonly parts: readonly RobotPart[];
    readonly connections: readonly RobotConnection[];
    readonly drivetrain: DrivetrainConfiguration | null;
    readonly foundation?: FoundationConfig | null;
    readonly arena?: ArenaConfig;
    readonly initialPose?: { readonly x?: number; readonly z?: number; readonly heading?: number };
    readonly collisionResponse?: SimulationWorldOptions["collisionResponse"];
    readonly runnerOptions?: SimulationWorldOptions["runnerOptions"];
    readonly maxFrameDeltaSeconds?: number;
  }): SimulationWorldInitResult<SimulationWorld> {
    const compilation = compileSimulationConfig({
      parts: params.parts,
      connections: params.connections,
      drivetrain: params.drivetrain,
      foundation: params.foundation,
    });

    if (!compilation.success || !compilation.config) {
      return {
        success: false,
        world: null,
        errors: compilation.errors.length > 0
          ? compilation.errors
          : ["Unable to compile robot configuration for simulation."],
        warnings: compilation.warnings,
      };
    }

    const targetArena = params.arena ?? SIMULATION_ARENA_PRESETS[0].arena;
    const arenaValidation = validateArena(targetArena);
    if (!arenaValidation.isValid) {
      return {
        success: false,
        world: null,
        errors: arenaValidation.errors,
        warnings: [...compilation.warnings, ...arenaValidation.warnings],
      };
    }

    try {
      const world = new SimulationWorld({
        robotConfig: compilation.config,
        arena: targetArena,
        initialPose: params.initialPose,
        collisionResponse: params.collisionResponse,
        runnerOptions: params.runnerOptions,
        maxFrameDeltaSeconds: params.maxFrameDeltaSeconds,
      });

      return {
        success: true,
        world,
        errors: [],
        warnings: [...compilation.warnings, ...arenaValidation.warnings],
      };
    } catch (error) {
      return {
        success: false,
        world: null,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: compilation.warnings,
      };
    }
  }

  subscribe(listener: SimulationWorldListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.lifecycleStatus);
    }
  }

  getLifecycleStatus(): SimulationLifecycleStatus {
    return this.lifecycleStatus;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getRobotConfig(): SimulationRobotConfig {
    return this.robotConfig;
  }

  getArena(): ArenaConfig {
    return this.arena;
  }

  getRunnerState(): SimulationRunnerState {
    return this.runnerState;
  }

  getActiveControls(): SimulationDriveControls {
    return this.activeControls;
  }

  getActiveInput(): DrivetrainInput {
    return this.activeInput;
  }

  getLatestStepDiagnostics(): DynamicsStepResult | null {
    return this.latestStepDiagnostics;
  }

  getCollisionIndicator(): SimulationCollisionSnapshot {
    return this.latestCollision;
  }

  getRenderPose(): SimulationRenderPose {
    const s = this.runnerState.simulationState;
    return {
      xMeters: s.xMeters,
      zMeters: s.zMeters,
      headingRadians: s.headingRadians,
      leftWheelAngularVelocityRadPerSec: s.leftWheelAngularVelocityRadPerSec,
      rightWheelAngularVelocityRadPerSec: s.rightWheelAngularVelocityRadPerSec,
      hasCollision: this.latestCollision.hasCollision,
      collidedBarrierIds: this.latestCollision.collidedBarrierIds,
    };
  }

  getTelemetrySnapshot(): SimulationTelemetrySnapshot {
    return buildTelemetrySnapshot(
      this.lifecycleStatus,
      this.runnerState.simulationState,
      this.latestCollision
    );
  }

  getDiagnostics(): SimulationWorldDiagnostics {
    return {
      lifecycleStatus: this.lifecycleStatus,
      activeControls: this.activeControls,
      activeInput: this.activeInput,
      runnerState: this.runnerState,
      telemetry: this.getTelemetrySnapshot(),
    };
  }

  start(): void {
    if (this.lifecycleStatus === "error") {
      return;
    }
    this.lifecycleStatus = "running";
    this.notify();
  }

  pause(): void {
    if (this.lifecycleStatus !== "running") {
      return;
    }
    this.clearInputs();
    this.lifecycleStatus = "paused";
    this.notify();
  }

  resume(): void {
    if (this.lifecycleStatus !== "paused") {
      return;
    }
    this.lifecycleStatus = "running";
    this.notify();
  }

  /**
   * Resets robot pose, velocities, motor/battery state, accumulator, inputs,
   * and collision diagnostics cleanly and deterministically.
   */
  reset(): void {
    this.clearInputs();
    this.runnerState = createInitialRunnerState(
      this.robotConfig,
      this.initialPose,
      this.runnerOptions
    );
    this.latestCollision = EMPTY_COLLISION_SNAPSHOT;
    this.latestStepDiagnostics = null;
    this.lastError = null;
    this.lifecycleStatus = "ready";
    this.notify();
  }

  /**
   * Switches the active arena and performs a clean deterministic reset.
   */
  setArena(arena: ArenaConfig): void {
    const validation = validateArena(arena);
    if (!validation.isValid) {
      throw new Error(`Invalid arena configuration: ${validation.errors.join("; ")}`);
    }
    this.arena = arena;
    this.runnerOptions = {
      ...this.runnerOptions,
      arena,
    };
    this.reset();
  }

  setDriveControls(controls: Partial<SimulationDriveControls>): void {
    const next: SimulationDriveControls = {
      forward: Boolean(controls.forward ?? this.activeControls.forward),
      reverse: Boolean(controls.reverse ?? this.activeControls.reverse),
      left: Boolean(controls.left ?? this.activeControls.left),
      right: Boolean(controls.right ?? this.activeControls.right),
    };
    this.activeControls = next;
    this.activeInput = mapDriveControlsToDrivetrainInput(next);
  }

  clearInputs(): void {
    this.activeControls = NEUTRAL_DRIVETRAIN_INPUT_CONTROLS;
    this.activeInput = NEUTRAL_DRIVETRAIN_INPUT;
  }

  /**
   * Advances simulation physics via advanceSimulation using the configured fixed timestep.
   * No-ops when paused, ready, or in error state.
   */
  stepFrame(frameDeltaSeconds: number): SimulationAdvanceResult | null {
    if (this.lifecycleStatus !== "running") {
      return null;
    }
    if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds <= 0) {
      return null;
    }

    const clampedDelta = Math.min(frameDeltaSeconds, this.maxFrameDeltaSeconds);

    try {
      const result = advanceSimulation(
        this.robotConfig,
        this.runnerState,
        this.activeInput,
        clampedDelta,
        this.runnerOptions
      );

      this.runnerState = result.runnerState;

      if (result.stepDiagnostics.length > 0) {
        const lastStep = result.stepDiagnostics[result.stepDiagnostics.length - 1];
        this.latestStepDiagnostics = lastStep;
        let collidingStep: DynamicsStepResult | undefined;
        for (let i = result.stepDiagnostics.length - 1; i >= 0; i--) {
          if (result.stepDiagnostics[i].collisionResponse?.hasCollisions) {
            collidingStep = result.stepDiagnostics[i];
            break;
          }
        }
        this.latestCollision = buildCollisionSnapshot(
          collidingStep?.collisionResponse ?? lastStep.collisionResponse
        );
      }

      return result;
    } catch (error) {
      this.clearInputs();
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lifecycleStatus = "error";
      this.notify();
      return null;
    }
  }

  /**
   * Halts simulation, clears active controls, and releases listeners on exit/unmount.
   */
  dispose(): void {
    this.clearInputs();
    if (this.lifecycleStatus === "running") {
      this.lifecycleStatus = "paused";
    }
    this.notify();
    this.listeners.clear();
  }
}

const NEUTRAL_DRIVETRAIN_INPUT_CONTROLS = NEUTRAL_DRIVE_CONTROLS;
