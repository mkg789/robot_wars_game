/**
 * Core leaf data contracts shared across simulation configuration, physics state,
 * and collision response without introducing module cycles.
 */

/**
 * Origin classification for an engineering assumption used in simulation.
 */
export type AssumptionSource =
  | "catalogue-unverified"
  | "derived-heuristic"
  | "standard-default"
  | "user-specified";

/**
 * Explicit engineering assumption used in simulation where verified component data is unavailable.
 */
export interface SimulationAssumption {
  readonly id: string;
  readonly parameter: string;
  readonly value: number | string | boolean;
  readonly unit?: string;
  readonly source: AssumptionSource;
  readonly description: string;
}

/**
 * Minimal dynamic runtime state for a 2D differential-drive simulation.
 */
export interface SimulationState {
  readonly timeSeconds: number;
  readonly stepCount: number;

  // 2D Pose in arena world frame (+X = forward baseline, +Z = left baseline, heading θ in radians)
  readonly xMeters: number;
  readonly zMeters: number;
  readonly headingRadians: number;

  // 2D Chassis velocities (body-fixed frame)
  readonly longitudinalVelocityMps: number;
  readonly lateralVelocityMps: number;
  readonly yawRateRadPerSec: number;

  // Chassis accelerations
  readonly longitudinalAccelerationMps2: number;
  readonly angularAccelerationRadPerSec2: number;

  // Wheel angular velocities & surface linear speeds
  readonly leftWheelAngularVelocityRadPerSec: number;
  readonly rightWheelAngularVelocityRadPerSec: number;
  readonly leftWheelLinearSurfaceSpeedMps: number;
  readonly rightWheelLinearSurfaceSpeedMps: number;

  // Traction slip ratios
  readonly leftSlipRatio: number;
  readonly rightSlipRatio: number;

  // Electrical runtime telemetry
  readonly batteryTerminalVoltageV: number;
  readonly totalCurrentDrawA: number;
  readonly isBatteryCutoff?: boolean;

  // Forces and torques
  readonly netDriveForceN: number;
  readonly netYawTorqueNm: number;
}
