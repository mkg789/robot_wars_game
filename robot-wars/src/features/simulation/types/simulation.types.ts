/**
 * Canonical data contracts for dynamic drivetrain simulation in Robot Wars.
 *
 * NOTE: These are pure data contracts and interfaces for simulation configuration,
 * inputs, state representation, assumptions, and telemetry.
 * Completely decoupled from React, Three.js, DOM, and UI rendering.
 */

import type {
  DrivetrainSide,
  DrivetrainType,
} from "../../robot-builder/types/robot.types";

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
 * Mechanical and electrical provenance metadata for a simulation component.
 */
export interface ComponentSimulationProvenance {
  readonly source: string;
  readonly verified: boolean;
  readonly notes?: string;
}

/**
 * Compiled simulation configuration for a drive motor.
 */
export interface MotorSimulationConfig {
  readonly motorId: string;
  readonly name: string;
  readonly side: DrivetrainSide;
  readonly slotIndex: number;
  /** Stall torque in canonical Newton-meters (N·m) */
  readonly stallTorqueNm: number;
  /** No-load rotational speed in revolutions per minute (RPM) */
  readonly noLoadRpm: number;
  /** No-load angular velocity in radians per second (rad/s) = (noLoadRpm * 2π) / 60 */
  readonly noLoadAngularVelocityRadPerSec: number;
  /** Nominal operating voltage in Volts (V), if specified */
  readonly nominalVoltageV?: number;
  /** Provenance metadata describing specification source and verification */
  readonly provenance: ComponentSimulationProvenance;
}

/**
 * Compiled simulation configuration for a driven wheel.
 */
export interface WheelSimulationConfig {
  readonly wheelId: string;
  readonly name: string;
  readonly side: DrivetrainSide;
  readonly slotIndex: number;
  /** Outer rolling diameter in canonical meters (m) */
  readonly diameterM: number;
  /** Contact radius in canonical meters (m) = diameter / 2 */
  readonly radiusM: number;
  /** Axial width in canonical meters (m), if defined */
  readonly widthM?: number;
  /** Static tire friction coefficient against arena surface, if specified in engineering spec */
  readonly staticFrictionCoeff?: number;
  /** Estimated baseline static normal load in Newtons (N) from stability analysis */
  readonly normalLoadN?: number;
  /** Provenance metadata describing geometric resolution source */
  readonly provenance: ComponentSimulationProvenance;
}

/**
 * Compiled simulation configuration for the robot battery power source.
 */
export interface BatterySimulationConfig {
  readonly batteryId: string;
  readonly name: string;
  readonly chemistry?: string;
  readonly cellCountS?: number;
  /** Nominal pack voltage in Volts (V) */
  readonly nominalVoltageV: number;
  /** Full charge pack voltage in Volts (V), if specified */
  readonly fullyChargedVoltageV?: number;
  /** Safe discharge floor cutoff voltage in Volts (V), if specified */
  readonly cutoffVoltageV?: number;
  /** Total pack capacity in milliampere-hours (mAh), if specified */
  readonly capacityMah?: number;
  /** Provenance metadata describing battery data source */
  readonly provenance: ComponentSimulationProvenance;
}

/**
 * Summary of drivetrain configuration for simulation.
 */
export interface DrivetrainSimulationSummary {
  readonly type: DrivetrainType;
  readonly drivenWheelCount: number;
  readonly leftSlotCount: number;
  readonly rightSlotCount: number;
}

/**
 * Static normal load distribution baseline for simulation tire friction limits.
 */
export interface NormalLoadBaseline {
  readonly totalNormalForceN: number;
  readonly leftSideNormalForceN: number;
  readonly rightSideNormalForceN: number;
  readonly perWheelLoads: readonly {
    readonly wheelId: string;
    readonly normalForceN: number;
    readonly isDriven: boolean;
  }[];
}

/**
 * Immutable compiled configuration of a robot ready for dynamic simulation.
 */
export interface SimulationRobotConfig {
  /** Total assembly mass in canonical kilograms (kg) */
  readonly totalMassKg: number;
  /** Center of mass coordinates in robot frame (m) */
  readonly centerOfMass: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  /** Body-frame yaw rotational moment of inertia (Iyy about vertical axis) in kg·m² */
  readonly yawInertiaKgM2: number;
  /** Lateral wheel track width between left and right driven wheel centers in meters (m) */
  readonly trackWidthM: number;
  /** Longitudinal wheelbase between front and rear axle centers in meters (m). Null for single-axle 2WD */
  readonly wheelbaseM: number | null;
  /** Drivetrain layout summary */
  readonly drivetrain: DrivetrainSimulationSummary;
  /** Compiled powered motor configurations */
  readonly motors: readonly MotorSimulationConfig[];
  /** Compiled driven wheel configurations */
  readonly wheels: readonly WheelSimulationConfig[];
  /** Primary battery specification */
  readonly battery: BatterySimulationConfig | null;
  /** Baseline normal ground reactions from static stability analysis */
  readonly normalLoads: NormalLoadBaseline | null;
  /** Explicit simulation assumptions applied during compilation */
  readonly assumptions: readonly SimulationAssumption[];
  /** Overall validity of the compiled simulation configuration */
  readonly validity: "valid" | "marginal" | "invalid";
  /** Compilation warnings that did not prevent configuration creation */
  readonly warnings: readonly string[];
}

/**
 * Normalized driver throttle input for a 2D differential drive robot.
 */
export interface DrivetrainInput {
  /** Left drive group normalized command in range [-1.0 (reverse) to +1.0 (forward)] */
  readonly leftThrottle: number;
  /** Right drive group normalized command in range [-1.0 (reverse) to +1.0 (forward)] */
  readonly rightThrottle: number;
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

/**
 * Telemetry snapshot for UI recording, plotting, or logging.
 */
export interface TelemetryFrame {
  readonly timestamp: number;
  readonly timeSeconds: number;
  readonly x: number;
  readonly z: number;
  readonly headingDeg: number;
  readonly speedMps: number;
  readonly speedKmh: number;
  readonly yawRateDegPerSec: number;
  readonly accelerationG: number;
  readonly batteryVoltageV: number;
  readonly currentA: number;
  readonly powerWatts: number;
  readonly leftSlip: number;
  readonly rightSlip: number;
}

/**
 * Result contract returned by compileSimulationConfig.
 */
export interface SimulationConfigCompilationResult {
  readonly success: boolean;
  readonly config: SimulationRobotConfig | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly assumptions: readonly SimulationAssumption[];
}

/**
 * Diagnostic metrics for a single driven wheel during a simulation timestep.
 */
export interface WheelDynamicsDiagnostic {
  readonly wheelId: string;
  readonly side: DrivetrainSide;
  readonly slotIndex: number;
  readonly motorId: string;
  readonly motorTorqueNm: number;
  readonly motorAngularVelocityRadPerSec: number;
  readonly wheelAngularVelocityRadPerSec: number;
  readonly surfaceSpeedMps: number;
  readonly groundContactSpeedMps: number;
  readonly slipRatio: number;
  readonly normalForceN: number;
  readonly tractionLimitN: number;
  readonly groundForceN: number;
  readonly isTractionLimited: boolean;
}

/**
 * Diagnostic metrics output from the 2D drivetrain dynamics engine for a timestep.
 */
export interface DrivetrainDynamicsDiagnostics {
  readonly timestepSeconds: number;
  readonly leftDriveForceN: number;
  readonly rightDriveForceN: number;
  readonly netLongitudinalForceN: number;
  readonly netYawTorqueNm: number;
  readonly linearAccelerationMps2: number;
  readonly angularAccelerationRadPerSec2: number;
  readonly wheels: readonly WheelDynamicsDiagnostic[];
  readonly isTractionLimited: boolean;
  readonly leftThrottle: number;
  readonly rightThrottle: number;
}

/**
 * Result of a single dynamics simulation step.
 */
export interface DynamicsStepResult {
  readonly state: SimulationState;
  readonly diagnostics: DrivetrainDynamicsDiagnostics;
}

/**
 * Configurable simulation options for battery dynamics.
 */
export interface BatterySimulationOptions {
  /**
   * Internal resistance of the battery pack in Ohms (Ω).
   * Default assumption for multi-cell LiPo packs: 0.025 Ω (25 mΩ).
   */
  readonly internalResistanceOhm?: number;
  /**
   * Open circuit voltage in Volts (V). If omitted, defaults to fullyChargedVoltageV or nominalVoltageV.
   */
  readonly openCircuitVoltageV?: number;
  /**
   * Cutoff voltage threshold in Volts (V). If omitted, defaults to battery.cutoffVoltageV or 0.8 * nominalVoltageV.
   */
  readonly cutoffVoltageV?: number;
  /**
   * Whether low-voltage cutoff is enabled (default: true).
   */
  readonly enableCutoff?: boolean;
}

/**
 * Diagnostics output for battery dynamics during a simulation step.
 */
export interface BatteryDynamicsDiagnostics {
  readonly openCircuitVoltageV: number;
  readonly terminalVoltageV: number;
  readonly voltageSagV: number;
  readonly currentDrawA: number;
  readonly internalResistanceOhm: number;
  readonly isCutoff: boolean;
  readonly cutoffVoltageV: number;
  readonly nominalVoltageV: number;
  readonly assumptions: readonly SimulationAssumption[];
}

/**
 * Configuration options for the deterministic simulation runner.
 */
export interface SimulationRunnerOptions {
  /**
   * Fixed physics timestep in seconds.
   * Default: 1 / 120 s (~0.008333 s).
   */
  readonly fixedTimestepSeconds?: number;
  /**
   * Maximum physics sub-steps permitted in a single advance call to prevent spiral of death.
   * Default: 120 steps.
   */
  readonly maxSubSteps?: number;
  /**
   * Battery simulation options.
   */
  readonly battery?: BatterySimulationOptions;
}

/**
 * Persistent state of the simulation runner across advance requests.
 */
export interface SimulationRunnerState {
  readonly simulationState: SimulationState;
  /** Remainder time in seconds accumulated from non-exact timestep requests */
  readonly accumulatorSeconds: number;
  /** Whether the battery has triggered low-voltage cutoff */
  readonly isCutoff: boolean;
  /** Cumulative simulated time advanced in seconds */
  readonly totalSimulatedTimeSeconds: number;
  /** Total physics integration steps executed by the runner */
  readonly totalPhysicsSteps: number;
}

/**
 * Result returned by advanceSimulation.
 */
export interface SimulationAdvanceResult {
  readonly runnerState: SimulationRunnerState;
  readonly durationRequestedSeconds: number;
  readonly timeAdvancedSeconds: number;
  readonly stepsExecuted: number;
  readonly fixedTimestepSeconds: number;
  readonly accumulatorRemainderSeconds: number;
  readonly batteryDiagnostics: BatteryDynamicsDiagnostics;
  readonly stepDiagnostics: readonly DynamicsStepResult[];
}

