import type { RuntimeElectricalState } from "./simulation.types";

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
  readonly electricalState?: RuntimeElectricalState;
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
