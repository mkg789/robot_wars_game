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

import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import { RobotControlController } from "../../programming/logic/robotControlController";
import type {
  CommandNormalizationResult,
  DifferentialDriveModel,
  DifferentialDriveOdometryState,
  DifferentialDriveResolution,
  MotorChannelTarget,
  OdometryPose,
  RobotControlApi,
  RobotControlRoutine,
  RobotProgramControllerState,
} from "../../programming/types/control.types";
import type {
  EncoderAccumulatorState,
  RobotSensorsSnapshot,
} from "../../programming/types/sensor.types";
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
  RuntimeElectricalState,
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
import { deriveRobotFootprintDimensions } from "./collisionModel";
import { resolveCollisionResponseConfig } from "./collisionResponse";
import {
  resolveCompiledRobotFootprint,
  resolveSafeSimulationSpawnPose,
  type SimulationSpawnPose,
} from "./simulationAssembly";
import { compileSimulationConfig } from "./simulationConfigCompiler";
import {
  advanceSimulation,
  buildUpdatedElectricalState,
  createInitialRunnerState,
  DEFAULT_FIXED_TIMESTEP_SECONDS,
  DEFAULT_MAX_SUB_STEPS,
  resetSimulationFuses,
  setSimulationSwitchState,
  stepSimulationFixed,
} from "./simulationRunner";
import { calculateBatteryOperatingPoint } from "./batteryDynamics";

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
 * Maps a keyboard key string (WASD or Arrow keys) to a SimulationDriveControls action.
 */
export function mapKeyboardKeyToDriveAction(
  key: string
): keyof SimulationDriveControls | null {
  switch (key.toLowerCase()) {
    case "w":
    case "arrowup":
      return "forward";
    case "s":
    case "arrowdown":
      return "reverse";
    case "a":
    case "arrowleft":
      return "left";
    case "d":
    case "arrowright":
      return "right";
    default:
      return null;
  }
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
  collision: SimulationCollisionSnapshot,
  electricalState?: RuntimeElectricalState
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
    ...(electricalState && { electricalState }),
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
  private readonly preferredInitialPose?: SimulationWorldOptions["initialPose"];
  private resolvedInitialPose: SimulationSpawnPose;
  private readonly robotFootprint: { readonly lengthM: number; readonly widthM: number };
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
  private readonly controlController: RobotControlController;
  private readonly baseParts: readonly RobotPart[];
  private readonly electricalConnections: readonly ElectricalConnection[];
  private pausedByWorld = false;
  private encoderAccumulator: EncoderAccumulatorState = {
    leftRadians: 0,
    rightRadians: 0,
    leftDistanceMeters: 0,
    rightDistanceMeters: 0,
  };

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

    const baseFootprint = deriveRobotFootprintDimensions(options.robotConfig);
    this.robotFootprint = {
      lengthM: options.runnerOptions?.robotFootprint?.lengthM ?? baseFootprint.lengthM,
      widthM: options.runnerOptions?.robotFootprint?.widthM ?? baseFootprint.widthM,
    };

    const spawnResolution = resolveSafeSimulationSpawnPose(
      options.arena,
      this.robotFootprint,
      options.initialPose
    );
    if (!spawnResolution.valid) {
      throw new Error(spawnResolution.error);
    }

    this.robotConfig = options.robotConfig;
    this.arena = options.arena;
    this.baseParts = options.parts ?? [];
    this.electricalConnections = options.electricalConnections ?? [];
    this.preferredInitialPose = options.initialPose
      ? {
          x: options.initialPose.x,
          z: options.initialPose.z,
          heading: options.initialPose.heading,
        }
      : undefined;
    this.resolvedInitialPose = spawnResolution.pose;
    this.maxFrameDeltaSeconds = maxDelta;
    this.runnerOptions = {
      ...options.runnerOptions,
      fixedTimestepSeconds:
        options.runnerOptions?.fixedTimestepSeconds ?? DEFAULT_FIXED_TIMESTEP_SECONDS,
      robotFootprint: this.robotFootprint,
      arena: options.arena,
      collisionResponse: options.collisionResponse,
    };
    this.runnerState = createInitialRunnerState(
      this.robotConfig,
      this.resolvedInitialPose,
      this.runnerOptions
    );
    this.controlController = new RobotControlController({
      robotConfig: this.robotConfig,
      parts: options.parts,
      electricalConnections: options.electricalConnections,
      arena: this.arena,
      simState: this.runnerState.simulationState,
    });
    this.syncRuntimeElectricalContext();
    this.controlController.updateSensorContext({
      arena: this.arena,
      simState: this.runnerState.simulationState,
      encoderAccumulator: this.encoderAccumulator,
    });
  }

  private syncRuntimeElectricalContext(): void {
    const elecState = this.runnerState.electricalState;
    const switchStates = elecState?.switchStates;
    const effectiveParts =
      switchStates && this.baseParts.length > 0
        ? this.baseParts.map((part) => {
            const runtimeClosed = switchStates[part.id];
            if (runtimeClosed === undefined) return part;
            return {
              ...part,
              electricalState: {
                ...part.electricalState,
                switchClosed: runtimeClosed,
              },
            };
          })
        : this.baseParts;

    this.controlController.updateHardwareContext({
      robotConfig: this.robotConfig,
      parts: effectiveParts,
      electricalConnections: this.electricalConnections,
      trippedFuseIds: elecState?.trippedFuseIds,
      isBatteryCutoff: this.runnerState.isCutoff,
      runtimeElectricalState: elecState,
      batteryTerminalVoltageV: this.runnerState.simulationState.batteryTerminalVoltageV,
    });
  }

  private didElectricalStatusChange(
    prevTripped: readonly string[] | undefined,
    prevCutoff: boolean
  ): boolean {
    if (prevCutoff !== this.runnerState.isCutoff) {
      return true;
    }
    const nextTripped = this.runnerState.electricalState?.trippedFuseIds;
    const prevLen = prevTripped?.length ?? 0;
    const nextLen = nextTripped?.length ?? 0;
    if (prevLen !== nextLen) {
      return true;
    }
    if (prevLen > 0 && prevTripped && nextTripped) {
      for (let i = 0; i < prevLen; i++) {
        if (prevTripped[i] !== nextTripped[i]) return true;
      }
    }
    return false;
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
    readonly electricalConnections?: readonly ElectricalConnection[];
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
      electricalConnections: params.electricalConnections,
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
      const assemblyFootprint = resolveCompiledRobotFootprint(
        compilation.config,
        params.parts
      );
      const world = new SimulationWorld({
        robotConfig: compilation.config,
        arena: targetArena,
        parts: params.parts,
        electricalConnections: params.electricalConnections,
        initialPose: params.initialPose,
        collisionResponse: params.collisionResponse,
        runnerOptions: {
          ...params.runnerOptions,
          robotFootprint: params.runnerOptions?.robotFootprint ?? assemblyFootprint,
        },
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

  getRobotFootprint(): { readonly lengthM: number; readonly widthM: number } {
    return this.robotFootprint;
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
      this.latestCollision,
      this.runnerState.electricalState
    );
  }

  getElectricalState(): RuntimeElectricalState | undefined {
    return this.runnerState.electricalState;
  }

  /**
   * Toggles a runtime power switch inside this simulation session (without requiring full rebuild).
   */
  setSwitchState(partId: string, isClosed: boolean): void {
    this.runnerState = setSimulationSwitchState(
      this.runnerState,
      partId,
      isClosed,
      this.robotConfig,
      this.runnerOptions
    );
    this.syncRuntimeElectricalContext();
    this.activeInput = this.controlController.getDrivetrainInput();
    this.notify();
  }

  /**
   * Clears runtime-tripped overcurrent fuses inside this simulation session.
   */
  resetFuses(): void {
    this.runnerState = resetSimulationFuses(
      this.runnerState,
      this.robotConfig,
      this.runnerOptions
    );
    this.syncRuntimeElectricalContext();
    this.activeInput = this.controlController.getDrivetrainInput();
    this.notify();
  }

  getDiagnostics(): SimulationWorldDiagnostics {
    return {
      lifecycleStatus: this.lifecycleStatus,
      activeControls: this.activeControls,
      activeInput: this.activeInput,
      runnerState: this.runnerState,
      telemetry: this.getTelemetrySnapshot(),
      controlState: this.controlController.getState(),
    };
  }

  getControlApi(): RobotControlApi {
    return this.controlController;
  }

  getControlState(): RobotProgramControllerState {
    return this.controlController.getState();
  }

  getActiveRoutine(): RobotControlRoutine | null {
    return this.controlController.getActiveRoutine();
  }

  getSensorsSnapshot(): RobotSensorsSnapshot | null {
    return this.controlController.readSensorsSnapshot();
  }

  setProgramRoutine(routine: RobotControlRoutine | null): void {
    this.pausedByWorld = false;
    this.controlController.setProgramRoutine(routine);
    this.activeInput = this.controlController.getDrivetrainInput();
    this.notify();
  }

  startProgram(): boolean {
    if (this.lifecycleStatus === "error") return false;
    this.pausedByWorld = false;
    this.activeControls = NEUTRAL_DRIVE_CONTROLS;
    const started = this.controlController.startProgram();
    this.activeInput = this.controlController.getDrivetrainInput();
    if (started && this.lifecycleStatus !== "running") {
      this.lifecycleStatus = "running";
    }
    this.notify();
    return started;
  }

  pauseProgram(): boolean {
    this.pausedByWorld = false;
    const paused = this.controlController.pauseProgram();
    this.activeControls = NEUTRAL_DRIVE_CONTROLS;
    this.activeInput = NEUTRAL_DRIVETRAIN_INPUT;
    this.notify();
    return paused;
  }

  resumeProgram(): boolean {
    if (this.lifecycleStatus === "error") return false;
    this.pausedByWorld = false;
    this.activeControls = NEUTRAL_DRIVE_CONTROLS;
    const resumed = this.controlController.resumeProgram();
    this.activeInput = this.controlController.getDrivetrainInput();
    if (resumed && this.lifecycleStatus !== "running") {
      this.lifecycleStatus = "running";
    }
    this.notify();
    return resumed;
  }

  /**
   * Executes one deterministic single-step debugger tick and integrates one physics slice,
   * leaving the program safely paused with zero held throttle afterward.
   */
  stepProgram(
    stepDtSeconds = DEFAULT_FIXED_TIMESTEP_SECONDS
  ): SimulationAdvanceResult | null {
    if (this.lifecycleStatus === "error") return null;
    if (!Number.isFinite(stepDtSeconds) || stepDtSeconds <= 0) return null;

    const clampedDelta = Math.min(stepDtSeconds, this.maxFrameDeltaSeconds);
    try {
      this.pausedByWorld = false;
      if (this.lifecycleStatus === "running") {
        this.lifecycleStatus = "paused";
      }
      this.activeControls = NEUTRAL_DRIVE_CONTROLS;
      const stepInput = this.controlController.stepProgramInstruction(
        this.getTelemetrySnapshot(),
        clampedDelta
      );
      const result = this.integratePhysicsStep(stepInput, clampedDelta);
      this.activeInput = this.controlController.getDrivetrainInput();
      this.notify();
      return result;
    } catch (error) {
      this.clearInputs();
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lifecycleStatus = "error";
      this.notify();
      return null;
    }
  }

  stopProgram(): void {
    this.pausedByWorld = false;
    this.controlController.stopProgram();
    this.activeControls = NEUTRAL_DRIVE_CONTROLS;
    this.activeInput = NEUTRAL_DRIVETRAIN_INPUT;
    this.notify();
  }

  setManualControlMode(): void {
    this.pausedByWorld = false;
    this.activeControls = NEUTRAL_DRIVE_CONTROLS;
    this.controlController.setControlSource("manual");
    this.controlController.stopRobot();
    this.activeInput = this.controlController.getDrivetrainInput();
    this.notify();
  }

  setMotorPower(
    target: MotorChannelTarget,
    power: number
  ): CommandNormalizationResult {
    if (this.lifecycleStatus === "error") {
      return {
        accepted: false,
        leftPower: 0,
        rightPower: 0,
        clamped: false,
        warnings: ["Simulation is in error state; reset before issuing motor commands."],
      };
    }
    this.pausedByWorld = false;
    const progStatus = this.controlController.getState().programStatus;
    if (progStatus === "running" || progStatus === "paused") {
      this.controlController.stopProgram();
    }
    if (this.controlController.getControlSource() === "manual") {
      this.controlController.setControlSource("program");
    }
    this.activeControls = NEUTRAL_DRIVE_CONTROLS;
    const result = this.controlController.setMotorPower(target, power);
    this.activeInput = this.controlController.getDrivetrainInput();
    this.notify();
    return result;
  }

  getDifferentialDriveModel(): DifferentialDriveModel {
    return this.controlController.getDifferentialDriveModel();
  }

  getOdometryState(): DifferentialDriveOdometryState {
    return this.controlController.getOdometryState();
  }

  resetOdometry(
    initialPose?: Partial<Pick<OdometryPose, "xMeters" | "zMeters" | "headingRadians">>
  ): DifferentialDriveOdometryState {
    const state = this.controlController.resetOdometry(initialPose);
    this.notify();
    return state;
  }

  private createErrorVelocityResolution(
    requestedLinearVelocityMps: number,
    requestedAngularVelocityRadPerSec: number
  ): DifferentialDriveResolution {
    return {
      accepted: false,
      modelValid: false,
      requestedLinearVelocityMps,
      requestedAngularVelocityRadPerSec,
      achievedLinearVelocityMps: 0,
      achievedAngularVelocityRadPerSec: 0,
      leftWheelAngularVelocityRadPerSec: 0,
      rightWheelAngularVelocityRadPerSec: 0,
      leftWheelLinearVelocityMps: 0,
      rightWheelLinearVelocityMps: 0,
      leftThrottle: 0,
      rightThrottle: 0,
      wheelTargets: [],
      saturated: false,
      saturationScale: 0,
      clampedNormalizedInput: false,
      warnings: ["Simulation is in error state; reset before issuing velocity commands."],
    };
  }

  private applyVelocityResolution<T extends DifferentialDriveResolution>(
    execute: () => T
  ): T {
    this.pausedByWorld = false;
    const progStatus = this.controlController.getState().programStatus;
    if (progStatus === "running" || progStatus === "paused") {
      this.controlController.stopProgram();
    }
    if (this.controlController.getControlSource() === "manual") {
      this.controlController.setControlSource("program");
    }
    this.activeControls = NEUTRAL_DRIVE_CONTROLS;
    const result = execute();
    this.activeInput = this.controlController.getDrivetrainInput();
    this.notify();
    return result;
  }

  setTwistVelocity(
    linearVelocityMps: number,
    angularVelocityRadPerSec: number
  ): DifferentialDriveResolution {
    if (this.lifecycleStatus === "error") {
      return this.createErrorVelocityResolution(0, 0);
    }
    return this.applyVelocityResolution(() =>
      this.controlController.setTwistVelocity(
        linearVelocityMps,
        angularVelocityRadPerSec
      )
    );
  }

  setNormalizedVelocity(
    linear: number,
    angular: number
  ): DifferentialDriveResolution {
    if (this.lifecycleStatus === "error") {
      return this.createErrorVelocityResolution(0, 0);
    }
    return this.applyVelocityResolution(() =>
      this.controlController.setNormalizedVelocity(linear, angular)
    );
  }

  stopMotors(target: MotorChannelTarget = "both"): CommandNormalizationResult {
    const result = this.controlController.stopMotors(target);
    this.activeInput = this.controlController.getDrivetrainInput();
    this.notify();
    return result;
  }

  stopRobot(): CommandNormalizationResult {
    this.activeControls = NEUTRAL_DRIVE_CONTROLS;
    const result = this.controlController.stopRobot();
    this.activeInput = NEUTRAL_DRIVETRAIN_INPUT;
    this.notify();
    return result;
  }

  start(): void {
    if (this.lifecycleStatus === "error" || this.lifecycleStatus === "running") {
      return;
    }
    if (this.lifecycleStatus === "paused") {
      this.resume();
      return;
    }
    this.lifecycleStatus = "running";
    this.notify();
  }

  pause(): void {
    if (this.lifecycleStatus !== "running") {
      return;
    }
    if (this.controlController.getState().programStatus === "running") {
      this.controlController.pauseProgram();
      this.pausedByWorld = true;
      this.activeControls = NEUTRAL_DRIVE_CONTROLS;
      this.activeInput = NEUTRAL_DRIVETRAIN_INPUT;
    } else {
      this.pausedByWorld = false;
      this.clearInputs();
    }
    this.lifecycleStatus = "paused";
    this.notify();
  }

  resume(): void {
    if (this.lifecycleStatus !== "paused") {
      return;
    }
    if (this.pausedByWorld) {
      this.pausedByWorld = false;
      this.controlController.resumeProgram();
      this.activeInput = this.controlController.getDrivetrainInput();
    }
    this.lifecycleStatus = "running";
    this.notify();
  }

  /**
   * Resets robot pose, velocities, motor/battery state, accumulator, inputs,
   * and collision diagnostics cleanly and deterministically.
   */
  reset(): void {
    this.pausedByWorld = false;
    this.encoderAccumulator = {
      leftRadians: 0,
      rightRadians: 0,
      leftDistanceMeters: 0,
      rightDistanceMeters: 0,
    };
    this.controlController.reset();
    this.clearInputs();
    this.runnerState = createInitialRunnerState(
      this.robotConfig,
      this.resolvedInitialPose,
      this.runnerOptions
    );
    this.syncRuntimeElectricalContext();
    this.controlController.updateSensorContext({
      arena: this.arena,
      simState: this.runnerState.simulationState,
      encoderAccumulator: this.encoderAccumulator,
    });
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
    const spawnResolution = resolveSafeSimulationSpawnPose(
      arena,
      this.robotFootprint,
      this.preferredInitialPose
    );
    if (!spawnResolution.valid) {
      throw new Error(spawnResolution.error);
    }
    this.arena = arena;
    this.resolvedInitialPose = spawnResolution.pose;
    this.runnerOptions = {
      ...this.runnerOptions,
      arena,
    };
    this.reset();
  }

  setDriveControls(controls: Partial<SimulationDriveControls>): void {
    if (this.lifecycleStatus === "error") {
      return;
    }
    this.pausedByWorld = false;
    this.controlController.setControlSource("manual");
    const next: SimulationDriveControls = {
      forward: Boolean(controls.forward ?? this.activeControls.forward),
      reverse: Boolean(controls.reverse ?? this.activeControls.reverse),
      left: Boolean(controls.left ?? this.activeControls.left),
      right: Boolean(controls.right ?? this.activeControls.right),
    };
    this.activeControls = next;
    const mapped = mapDriveControlsToDrivetrainInput(next);
    this.controlController.setDifferentialPower(
      mapped.leftThrottle,
      mapped.rightThrottle
    );
    this.activeInput = this.controlController.getDrivetrainInput();
  }

  clearInputs(): void {
    this.activeControls = NEUTRAL_DRIVETRAIN_INPUT_CONTROLS;
    this.controlController.stopRobot();
    this.activeInput = NEUTRAL_DRIVETRAIN_INPUT;
  }

  private recordStepDiagnostics(
    steps: readonly DynamicsStepResult[],
    prevTripped: readonly string[] | undefined,
    prevCutoff: boolean
  ): void {
    if (this.didElectricalStatusChange(prevTripped, prevCutoff)) {
      this.syncRuntimeElectricalContext();
    }

    if (steps.length > 0) {
      for (const step of steps) {
        const stepDt = step.diagnostics.timestepSeconds;
        this.encoderAccumulator = {
          leftRadians:
            this.encoderAccumulator.leftRadians +
            step.state.leftWheelAngularVelocityRadPerSec * stepDt,
          rightRadians:
            this.encoderAccumulator.rightRadians +
            step.state.rightWheelAngularVelocityRadPerSec * stepDt,
          leftDistanceMeters:
            this.encoderAccumulator.leftDistanceMeters +
            step.state.leftWheelLinearSurfaceSpeedMps * stepDt,
          rightDistanceMeters:
            this.encoderAccumulator.rightDistanceMeters +
            step.state.rightWheelLinearSurfaceSpeedMps * stepDt,
        };
        this.controlController.updateSensorContext({
          arena: this.arena,
          simState: step.state,
          encoderAccumulator: this.encoderAccumulator,
        });
      }

      const lastStep = steps[steps.length - 1];
      this.latestStepDiagnostics = lastStep;
      let collidingStep: DynamicsStepResult | undefined;
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].collisionResponse?.hasCollisions) {
          collidingStep = steps[i];
          break;
        }
      }
      this.latestCollision = buildCollisionSnapshot(
        collidingStep?.collisionResponse ?? lastStep.collisionResponse
      );
      return;
    }

    this.controlController.updateSensorContext({
      arena: this.arena,
      simState: this.runnerState.simulationState,
      encoderAccumulator: this.encoderAccumulator,
    });
  }

  private integratePhysicsStep(
    input: DrivetrainInput,
    clampedDelta: number
  ): SimulationAdvanceResult {
    const prevTripped = this.runnerState.electricalState?.trippedFuseIds;
    const prevCutoff = this.runnerState.isCutoff;
    const result = advanceSimulation(
      this.robotConfig,
      this.runnerState,
      input,
      clampedDelta,
      this.runnerOptions
    );

    this.runnerState = result.runnerState;
    this.recordStepDiagnostics(result.stepDiagnostics, prevTripped, prevCutoff);

    return result;
  }

  /**
   * Advances simulation physics via advanceSimulation using the configured fixed timestep.
   * When an autonomous/visual program is actively running, steps program logic at the exact
   * fixed physics timestep so timed blocks and sensor checks remain frame-rate independent.
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
      const ctrlState = this.controlController.getState();
      const isProgramActivelyRunning =
        ctrlState.controlSource !== "manual" && ctrlState.programStatus === "running";

      if (!isProgramActivelyRunning) {
        this.activeInput = this.controlController.beforePhysicsStep(
          this.getTelemetrySnapshot(),
          clampedDelta
        );
        return this.integratePhysicsStep(this.activeInput, clampedDelta);
      }

      const fixedTimestep =
        this.runnerOptions.fixedTimestepSeconds ?? DEFAULT_FIXED_TIMESTEP_SECONDS;
      const maxSubSteps = this.runnerOptions.maxSubSteps ?? DEFAULT_MAX_SUB_STEPS;
      let accumulator = this.runnerState.accumulatorSeconds + clampedDelta;
      const stepThreshold = fixedTimestep - 1e-9;
      let stepsExecuted = 0;
      const stepDiagnostics: DynamicsStepResult[] = [];
      let latestBatteryDiag = calculateBatteryOperatingPoint(
        this.robotConfig,
        this.runnerState.simulationState,
        this.activeInput,
        this.runnerOptions.battery,
        this.runnerState.isCutoff,
        this.runnerState.electricalState
          ? {
              switchStates: this.runnerState.electricalState.switchStates,
              trippedFuseIds: this.runnerState.electricalState.trippedFuseIds,
            }
          : undefined
      );

      while (accumulator >= stepThreshold && stepsExecuted < maxSubSteps) {
        const prevTripped = this.runnerState.electricalState?.trippedFuseIds;
        const prevCutoff = this.runnerState.isCutoff;
        this.activeInput = this.controlController.beforePhysicsStep(
          this.getTelemetrySnapshot(),
          fixedTimestep
        );
        const elecControl = this.runnerState.electricalState
          ? {
              switchStates: this.runnerState.electricalState.switchStates,
              trippedFuseIds: this.runnerState.electricalState.trippedFuseIds,
            }
          : undefined;
        const stepRes = stepSimulationFixed(
          this.robotConfig,
          this.runnerState.simulationState,
          this.activeInput,
          fixedTimestep,
          this.runnerOptions,
          this.runnerState.isCutoff,
          elecControl
        );

        latestBatteryDiag = stepRes.batteryDiagnostics;
        const updatedElec = buildUpdatedElectricalState(
          this.runnerState.electricalState,
          latestBatteryDiag
        );
        this.runnerState = {
          simulationState: stepRes.state,
          accumulatorSeconds: accumulator - fixedTimestep,
          isCutoff: stepRes.isCutoff,
          totalSimulatedTimeSeconds:
            this.runnerState.totalSimulatedTimeSeconds + fixedTimestep,
          totalPhysicsSteps: this.runnerState.totalPhysicsSteps + 1,
          ...(updatedElec && { electricalState: updatedElec }),
        };
        stepDiagnostics.push(stepRes.diagnostics);
        this.recordStepDiagnostics(
          [stepRes.diagnostics],
          prevTripped,
          prevCutoff
        );

        accumulator -= fixedTimestep;
        stepsExecuted++;
      }

      if (accumulator < 1e-9) {
        accumulator = 0;
      }

      if (this.runnerState.accumulatorSeconds !== accumulator) {
        this.runnerState = {
          ...this.runnerState,
          accumulatorSeconds: accumulator,
        };
      }

      const timeAdvancedSeconds = stepsExecuted * fixedTimestep;
      return {
        runnerState: this.runnerState,
        durationRequestedSeconds: clampedDelta,
        timeAdvancedSeconds,
        stepsExecuted,
        fixedTimestepSeconds: fixedTimestep,
        accumulatorRemainderSeconds: accumulator,
        batteryDiagnostics: latestBatteryDiag,
        stepDiagnostics,
      };
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
