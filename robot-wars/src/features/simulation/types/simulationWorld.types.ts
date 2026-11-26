/**
 * Canonical data contracts for the Phase 4.2 Simulation World orchestration layer.
 *
 * Bridges the pure deterministic simulation engine with the interactive frontend viewport,
 * lifecycle controls, keyboard/UI drive inputs, and read-only telemetry snapshots
 * without embedding physics in React or Three.js.
 */

import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type { RobotProgramControllerState } from "../../programming/types/control.types";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import type { ArenaConfig } from "./arena.types";
import type {
  CollisionResponseOptions,
  DrivetrainInput,
  SimulationRobotConfig,
  SimulationRunnerOptions,
  SimulationRunnerState,
} from "./simulation.types";

/**
 * Lifecycle states for an interactive simulation world session.
 */
export type SimulationLifecycleStatus =
  | "ready"
  | "running"
  | "paused"
  | "error";

/**
 * Normalized directional drive control flags (WASD / Arrow keys / directional buttons).
 */
export interface SimulationDriveControls {
  readonly forward: boolean;
  readonly reverse: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/**
 * Read-only collision indicator snapshot derived from CollisionResponseResult.
 */
export interface SimulationCollisionSnapshot {
  readonly hasCollision: boolean;
  readonly contactCount: number;
  readonly collidedBarrierIds: readonly string[];
  readonly totalNormalImpulseNs: number;
  readonly maxPenetrationDepthM: number;
}

/**
 * Read-only live telemetry snapshot sourced strictly from simulation state and diagnostics.
 */
export interface SimulationTelemetrySnapshot {
  readonly lifecycleStatus: SimulationLifecycleStatus;
  readonly timeSeconds: number;
  readonly stepCount: number;
  readonly xMeters: number;
  readonly zMeters: number;
  readonly headingRadians: number;
  readonly headingDegrees: number;
  readonly longitudinalVelocityMps: number;
  readonly lateralVelocityMps: number;
  readonly yawRateRadPerSec: number;
  readonly yawRateDegPerSec: number;
  readonly longitudinalAccelerationMps2: number;
  readonly angularAccelerationRadPerSec2: number;
  readonly batteryTerminalVoltageV: number;
  readonly totalCurrentDrawA: number;
  readonly isBatteryCutoff: boolean;
  readonly collision: SimulationCollisionSnapshot;
}

/**
 * Lightweight planar pose & wheel speed snapshot consumed imperatively by the 3D viewport.
 */
export interface SimulationRenderPose {
  readonly xMeters: number;
  readonly zMeters: number;
  readonly headingRadians: number;
  readonly leftWheelAngularVelocityRadPerSec: number;
  readonly rightWheelAngularVelocityRadPerSec: number;
  readonly hasCollision: boolean;
  readonly collidedBarrierIds: readonly string[];
}

/**
 * Named arena preset available for selection in the simulation world.
 */
export interface SimulationArenaPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly arena: ArenaConfig;
}

/**
 * Initialization options for constructing a SimulationWorld instance.
 */
export interface SimulationWorldOptions {
  readonly robotConfig: SimulationRobotConfig;
  readonly arena: ArenaConfig;
  readonly parts?: readonly RobotPart[];
  readonly electricalConnections?: readonly ElectricalConnection[];
  readonly initialPose?: {
    readonly x?: number;
    readonly z?: number;
    readonly heading?: number;
  };
  readonly collisionResponse?: CollisionResponseOptions;
  readonly runnerOptions?: Omit<SimulationRunnerOptions, "arena" | "collisionResponse">;
  readonly maxFrameDeltaSeconds?: number;
}

/**
 * Result returned by SimulationWorld factory helpers when compiling from assembly data.
 */
export interface SimulationWorldInitResult<TWorld = unknown> {
  readonly success: boolean;
  readonly world: TWorld | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Snapshot of runner and world state exposed for inspection and testing.
 */
export interface SimulationWorldDiagnostics {
  readonly lifecycleStatus: SimulationLifecycleStatus;
  readonly activeControls: SimulationDriveControls;
  readonly activeInput: DrivetrainInput;
  readonly runnerState: SimulationRunnerState;
  readonly telemetry: SimulationTelemetrySnapshot;
  readonly controlState: RobotProgramControllerState;
}
