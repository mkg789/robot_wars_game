import type { SimulationTelemetrySnapshot } from "../../simulation/types/simulationTelemetry.types";
import type { DrivetrainType } from "../../robot-builder/types/robot.types";
import type {
  EncoderData,
  ImuData,
  IrProximityData,
  LineSensorData,
  RobotSensorsSnapshot,
  SensorAvailabilityStatus,
  SensorDescriptor,
  SensorReadResult,
  UltrasonicDistanceData,
} from "./sensor.types";
import type { VisualProgramExecutionTrace } from "./programWorkspace.types";

export type RobotControlSource = "manual" | "program" | "autonomous";

export type RobotProgramStatus =
  | "idle"
  | "running"
  | "paused"
  | "stopped"
  | "fault"
  | "completed";

export type MotorChannelTarget = "left" | "right" | "both";

export interface DifferentialDriveGeometryOverride {
  readonly trackWidthM?: number;
  readonly wheelRadiusM?: number;
  readonly leftWheelRadiusM?: number;
  readonly rightWheelRadiusM?: number;
}

export interface DifferentialDriveTwistCommand {
  /** Requested forward linear velocity in canonical meters/second (+X forward). */
  readonly linearVelocityMps: number;
  /** Requested yaw angular velocity in radians/second (+Y CCW, turning left). */
  readonly angularVelocityRadPerSec: number;
}

export interface NormalizedVelocityCommand {
  /** Normalized forward/reverse velocity request in [-1, 1]. */
  readonly linear: number;
  /** Normalized left(+)/right(-) turn rate request in [-1, 1]. */
  readonly angular: number;
}

export interface DifferentialDriveSideModel {
  readonly side: "left" | "right";
  readonly wheelCount: number;
  readonly wheelIds: readonly string[];
  readonly motorIds: readonly string[];
  /** Aggregated rolling wheel radius in meters for this side. */
  readonly effectiveWheelRadiusM: number;
  /** Achievable maximum synchronous wheel angular velocity in rad/s under motor/electrical limits. */
  readonly maxWheelAngularVelocityRadPerSec: number;
  /** Achievable maximum ground linear speed in m/s at this side's baseline. */
  readonly maxLinearVelocityMps: number;
  /** Sum of effective motor stall torques on this side (N·m). */
  readonly totalStallTorqueNm: number;
  readonly poweredMotorCount: number;
  readonly isDrivable: boolean;
}

export interface DifferentialDriveModel {
  readonly isValid: boolean;
  readonly drivetrainType: DrivetrainType | "unsupported";
  readonly trackWidthM: number;
  readonly left: DifferentialDriveSideModel;
  readonly right: DifferentialDriveSideModel;
  /** Maximum symmetric straight-line speed magnitude in m/s. */
  readonly maxLinearVelocityMps: number;
  /** Maximum in-place yaw rate magnitude in rad/s. */
  readonly maxAngularVelocityRadPerSec: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface DifferentialWheelTarget {
  readonly wheelId: string;
  readonly motorId: string;
  readonly side: "left" | "right";
  readonly slotIndex: number;
  readonly radiusM: number;
  readonly targetAngularVelocityRadPerSec: number;
  readonly targetLinearVelocityMps: number;
}

export interface DifferentialDriveResolution {
  readonly accepted: boolean;
  readonly modelValid: boolean;
  readonly requestedLinearVelocityMps: number;
  readonly requestedAngularVelocityRadPerSec: number;
  readonly achievedLinearVelocityMps: number;
  readonly achievedAngularVelocityRadPerSec: number;
  readonly leftWheelAngularVelocityRadPerSec: number;
  readonly rightWheelAngularVelocityRadPerSec: number;
  readonly leftWheelLinearVelocityMps: number;
  readonly rightWheelLinearVelocityMps: number;
  readonly leftThrottle: number;
  readonly rightThrottle: number;
  readonly wheelTargets: readonly DifferentialWheelTarget[];
  readonly saturated: boolean;
  readonly saturationScale: number;
  readonly clampedNormalizedInput: boolean;
  readonly warnings: readonly string[];
}

export type OdometryStatus =
  | "ready"
  | "uninitialized"
  | "unavailable-encoders"
  | "unavailable-unpowered"
  | "unavailable-electrical-fault"
  | "invalid-geometry";

export interface OdometryPose {
  readonly xMeters: number;
  readonly zMeters: number;
  readonly headingRadians: number;
  readonly headingDegrees: number;
}

export interface OdometryStepDelta {
  readonly leftRadians: number;
  readonly rightRadians: number;
  readonly leftMeters: number;
  readonly rightMeters: number;
  readonly linearMeters: number;
  readonly angularRadians: number;
  readonly dtSeconds: number;
}

export interface OdometryVelocityEstimate {
  readonly linearVelocityMps: number;
  readonly angularVelocityRadPerSec: number;
}

export interface OdometryEncoderChannelSnapshot {
  readonly encoderCount: number;
  readonly readyCount: number;
  readonly cumulativeRadians: number;
}

export interface DifferentialDriveOdometryState {
  readonly isValid: boolean;
  readonly status: OdometryStatus;
  readonly pose: OdometryPose;
  readonly velocity: OdometryVelocityEstimate;
  readonly leftDistanceMeters: number;
  readonly rightDistanceMeters: number;
  readonly traveledDistanceMeters: number;
  readonly leftChannel: OdometryEncoderChannelSnapshot;
  readonly rightChannel: OdometryEncoderChannelSnapshot;
  readonly lastStep: OdometryStepDelta;
  readonly updateCount: number;
  readonly timestampSeconds: number;
  readonly warnings: readonly string[];
  readonly error?: string;
}

export interface PidLimits {
  readonly min: number;
  readonly max: number;
}

export type PidDerivativeMode = "measurement" | "error";

export interface PidConfig {
  readonly kp: number;
  readonly ki: number;
  readonly kd: number;
  /** Optional saturation bounds `[min, max]` applied to final PID output. */
  readonly outputLimits?: PidLimits;
  /** Optional bounds `[min, max]` applied to the accumulated integral output contribution. */
  readonly integralLimits?: PidLimits;
  /** Optional first-order low-pass filter time constant τ_d in seconds (τ_d >= 0; 0 disables filtering). */
  readonly derivativeFilterTimeConstantSeconds?: number;
  /** Optional fixed smoothing factor α in (0, 1] used when derivativeFilterTimeConstantSeconds is omitted. */
  readonly derivativeFilterAlpha?: number;
  /** Derivative formulation for setpoint/measurement updates (defaults to `"measurement"`). */
  readonly derivativeMode?: PidDerivativeMode;
}

export interface PidTermBreakdown {
  readonly proportional: number;
  readonly integral: number;
  readonly derivative: number;
  readonly rawDerivative: number;
  readonly unsaturatedOutput: number;
}

export interface PidState {
  readonly isConfigValid: boolean;
  readonly hasPreviousSample: boolean;
  readonly previousSetpoint: number;
  readonly previousMeasurement: number | null;
  readonly previousError: number;
  readonly integralTerm: number;
  readonly filteredDerivativeTerm: number;
  readonly lastOutput: number;
  readonly lastTerms: PidTermBreakdown;
  readonly lastDtSeconds: number;
  readonly saturated: boolean;
  readonly antiWindupActive: boolean;
  readonly updateCount: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export type ClosedLoopMotionKind =
  | "velocity-hold"
  | "drive-distance"
  | "turn-to-heading"
  | "relative-turn";

export type ClosedLoopMotionStatus =
  | "idle"
  | "running"
  | "completed"
  | "timed-out"
  | "cancelled"
  | "failed";

export interface ClosedLoopMotionOptions {
  readonly maxLinearSpeedMps?: number;
  readonly maxAngularSpeedRadPerSec?: number;
  readonly distanceToleranceMeters?: number;
  readonly headingToleranceRadians?: number;
  readonly linearVelocityToleranceMps?: number;
  readonly angularVelocityToleranceRadPerSec?: number;
  readonly settleStepCount?: number;
  readonly timeoutSeconds?: number;
  readonly holdHeading?: boolean;
  readonly linearVelocityPid?: Partial<PidConfig>;
  readonly angularVelocityPid?: Partial<PidConfig>;
  readonly distancePid?: Partial<PidConfig>;
  readonly headingPid?: Partial<PidConfig>;
}

export interface ClosedLoopMotionProgress {
  readonly distanceTraveledMeters: number;
  readonly remainingDistanceMeters: number;
  readonly headingDeltaRadians: number;
  readonly headingErrorRadians: number;
  readonly linearVelocityErrorMps: number;
  readonly angularVelocityErrorRadPerSec: number;
  readonly settleCounter: number;
}

export interface ClosedLoopMotionPidBundle {
  readonly linearVelocity: PidState;
  readonly angularVelocity: PidState;
  readonly distance: PidState;
  readonly heading: PidState;
}

export interface ClosedLoopMotionState {
  readonly kind: ClosedLoopMotionKind | null;
  readonly status: ClosedLoopMotionStatus;
  readonly isActive: boolean;
  readonly elapsedSeconds: number;
  readonly stepCount: number;
  readonly targetLinearVelocityMps: number;
  readonly targetAngularVelocityRadPerSec: number;
  readonly targetDistanceMeters: number;
  readonly targetHeadingRadians: number;
  readonly targetDeltaHeadingRadians: number;
  readonly progress: ClosedLoopMotionProgress;
  readonly commandedTwist: DifferentialDriveTwistCommand;
  readonly lastResolution: DifferentialDriveResolution | null;
  readonly pidStates: ClosedLoopMotionPidBundle;
  readonly failureReason?: string;
  readonly warnings: readonly string[];
}

export type NavigationStatus =
  | "idle"
  | "navigating"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface NavigationWaypoint {
  readonly xMeters: number;
  readonly zMeters: number;
  readonly label?: string;
}

export type ObstacleAvoidanceStatus =
  | "idle"
  | "clear"
  | "slowing"
  | "stopped"
  | "avoiding"
  | "blocked"
  | "cancelled";

export type ObstacleAvoidanceManeuverPhase =
  | "none"
  | "stop-confirm"
  | "turn"
  | "advance"
  | "verify-clear";

export type AvoidanceDirection = "left" | "right";

export interface DistanceSensorObservation {
  readonly sensorId: string;
  readonly sensorName: string;
  readonly sensorKind: "ultrasonic" | "tof-distance";
  readonly localMountOffset: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly mountYawOffsetRadians: number;
  readonly reading: SensorReadResult<UltrasonicDistanceData>;
}

export interface ObstacleAvoidanceOptions {
  readonly enabled?: boolean;
  readonly requireValidSensor?: boolean;
  readonly detectionDistanceMeters?: number;
  readonly slowdownDistanceMeters?: number;
  readonly safetyDistanceMeters?: number;
  readonly clearHysteresisMeters?: number;
  readonly minSlowdownSpeedScale?: number;
  readonly avoidTurnSpeedRadPerSec?: number;
  readonly avoidAdvanceSpeedMps?: number;
  readonly minAvoidTurnRadians?: number;
  readonly maxAvoidTurnRadians?: number;
  readonly avoidAdvanceDistanceMeters?: number;
  readonly stopConfirmSeconds?: number;
  readonly verifyClearSeconds?: number;
  readonly cooldownSeconds?: number;
  readonly maxAvoidanceAttempts?: number;
  readonly maxManeuverSeconds?: number;
  readonly defaultDirection?: AvoidanceDirection;
  readonly directionHysteresisMeters?: number;
}

export interface ObstacleAvoidanceState {
  readonly enabled: boolean;
  readonly status: ObstacleAvoidanceStatus;
  readonly maneuverPhase: ObstacleAvoidanceManeuverPhase;
  readonly isActive: boolean;
  readonly chosenDirection: AvoidanceDirection | null;
  readonly nearestObstacleDistanceMeters: number | null;
  readonly forwardObstacleDistanceMeters: number | null;
  readonly leftClearanceMeters: number | null;
  readonly rightClearanceMeters: number | null;
  readonly detectedSensorId: string | null;
  readonly sensorStatus: SensorAvailabilityStatus;
  readonly activeSpeedScale: number;
  readonly commandedLinearVelocityMps: number;
  readonly commandedAngularVelocityRadPerSec: number;
  readonly maneuverTurnProgressRadians: number;
  readonly maneuverAdvanceProgressMeters: number;
  readonly attemptCount: number;
  readonly cooldownRemainingSeconds: number;
  readonly maneuverElapsedSeconds: number;
  readonly stepCount: number;
  readonly failureReason?: string;
  readonly warnings: readonly string[];
}

export interface WaypointNavigationOptions {
  readonly acceptanceRadiusMeters?: number;
  readonly headingToleranceRadians?: number;
  readonly turnInPlaceThresholdRadians?: number;
  readonly maxLinearSpeedMps?: number;
  readonly maxAngularSpeedRadPerSec?: number;
  readonly headingGain?: number;
  readonly approachGain?: number;
  readonly timeoutSeconds?: number;
  readonly linearVelocityPid?: Partial<PidConfig>;
  readonly angularVelocityPid?: Partial<PidConfig>;
  readonly obstacleAvoidance?: ObstacleAvoidanceOptions;
}

export interface WaypointNavigationState {
  readonly status: NavigationStatus;
  readonly isActive: boolean;
  readonly waypoints: readonly NavigationWaypoint[];
  readonly currentWaypointIndex: number;
  readonly totalWaypoints: number;
  readonly completedWaypoints: number;
  readonly currentTarget: NavigationWaypoint | null;
  readonly estimatedDistanceMeters: number;
  readonly estimatedHeadingRadians: number;
  readonly desiredHeadingRadians: number;
  readonly headingErrorRadians: number;
  readonly targetLinearVelocityMps: number;
  readonly targetAngularVelocityRadPerSec: number;
  readonly acceptanceRadiusMeters: number;
  readonly elapsedSeconds: number;
  readonly stepCount: number;
  readonly failureReason?: string;
  readonly warnings: readonly string[];
}

export type PidUpdateInput =
  | {
      readonly setpoint: number;
      readonly measurement: number;
      readonly dtSeconds: number;
    }
  | {
      readonly error: number;
      readonly dtSeconds: number;
      readonly measurement?: number;
    };

export interface PidStepResult {
  readonly accepted: boolean;
  readonly output: number;
  readonly error: number;
  readonly saturated: boolean;
  readonly antiWindupActive: boolean;
  readonly terms: PidTermBreakdown;
  readonly state: PidState;
  readonly warnings: readonly string[];
}

export type RobotActuatorCommand =
  | {
      readonly kind: "set-motor-power";
      readonly target: MotorChannelTarget;
      readonly power: number;
    }
  | {
      readonly kind: "set-differential-drive";
      readonly leftPower: number;
      readonly rightPower: number;
    }
  | {
      readonly kind: "set-twist-velocity";
      readonly linearVelocityMps: number;
      readonly angularVelocityRadPerSec: number;
    }
  | {
      readonly kind: "set-normalized-velocity";
      readonly linear: number;
      readonly angular: number;
    }
  | {
      readonly kind: "stop-motors";
      readonly target?: MotorChannelTarget;
    }
  | {
      readonly kind: "stop-robot";
    }
  | {
      readonly kind: "extensible-actuator";
      readonly actuatorId: string;
      readonly channel?: string;
      readonly value: number;
    };

export interface NormalizedDriveTarget {
  readonly leftPower: number;
  readonly rightPower: number;
  readonly lastCommandAtSeconds: number;
  readonly activeCommandKind: string;
  readonly clampedValues: boolean;
}

export interface MotorHardwareBinding {
  readonly leftMotorIds: readonly string[];
  readonly rightMotorIds: readonly string[];
  readonly hasLeftMotors: boolean;
  readonly hasRightMotors: boolean;
  readonly canDrive: boolean;
  readonly electricalMode:
    | "mechanical-only"
    | "electrically-verified"
    | "electrical-fault";
  readonly faultReason?: string;
  readonly warnings: readonly string[];
}

export interface CommandNormalizationResult {
  readonly accepted: boolean;
  readonly leftPower: number;
  readonly rightPower: number;
  readonly clamped: boolean;
  readonly warnings: readonly string[];
}

export interface RobotProgramStepContext {
  readonly timeSeconds: number;
  readonly dtSeconds: number;
  readonly stepCount: number;
  readonly pose: {
    readonly xMeters: number;
    readonly zMeters: number;
    readonly headingRadians: number;
    readonly headingDegrees: number;
  };
  readonly velocity: {
    readonly longitudinalMps: number;
    readonly lateralMps: number;
    readonly yawRateRadPerSec: number;
  };
  readonly battery: {
    readonly terminalVoltageV: number;
    readonly totalCurrentDrawA: number;
    readonly isCutoff: boolean;
  };
  readonly collision: {
    readonly hasCollision: boolean;
    readonly contactCount: number;
    readonly collidedBarrierIds: readonly string[];
  };
  /** Typed simulated sensor snapshot from actual installed robot sensors. */
  readonly sensors?: RobotSensorsSnapshot;
  /** Encoder-derived differential-drive odometry estimate (independent from ground-truth pose). */
  readonly odometry?: DifferentialDriveOdometryState;
  /** Active or last closed-loop motion primitive state. */
  readonly motion?: ClosedLoopMotionState;
  /** Active or last waypoint navigation state. */
  readonly navigation?: WaypointNavigationState;
  /** Active or last sensor-driven obstacle avoidance state. */
  readonly avoidance?: ObstacleAvoidanceState;
  /** True when invoked from single-step debugger control. */
  readonly isSingleStep?: boolean;
}

export interface RobotControlApi {
  setMotorPower: (
    target: MotorChannelTarget,
    power: number
  ) => CommandNormalizationResult;
  setLeftMotorPower: (power: number) => CommandNormalizationResult;
  setRightMotorPower: (power: number) => CommandNormalizationResult;
  setDifferentialPower: (
    leftPower: number,
    rightPower: number
  ) => CommandNormalizationResult;
  getDifferentialDriveModel: () => DifferentialDriveModel;
  setTwistVelocity: (
    linearVelocityMps: number,
    angularVelocityRadPerSec: number
  ) => DifferentialDriveResolution;
  setNormalizedVelocity: (
    linear: number,
    angular: number
  ) => DifferentialDriveResolution;
  stopMotors: (target?: MotorChannelTarget) => CommandNormalizationResult;
  stopRobot: () => CommandNormalizationResult;
  dispatchCommand: (command: RobotActuatorCommand) => CommandNormalizationResult;
  completeProgram: () => void;
  reportExecutionTrace?: (trace: VisualProgramExecutionTrace) => void;
  getInstalledSensors: () => readonly SensorDescriptor[];
  readUltrasonic: (sensorId?: string) => SensorReadResult<UltrasonicDistanceData>;
  readProximity: (sensorId?: string) => SensorReadResult<IrProximityData>;
  readLineSensor: (sensorId?: string) => SensorReadResult<LineSensorData>;
  readImu: (sensorId?: string) => SensorReadResult<ImuData>;
  readEncoder: (
    sideOrSensorId?: "left" | "right" | "average" | string
  ) => SensorReadResult<EncoderData>;
  readSensorsSnapshot: () => RobotSensorsSnapshot | null;
  getOdometryState: () => DifferentialDriveOdometryState;
  resetOdometry: (
    initialPose?: Partial<Pick<OdometryPose, "xMeters" | "zMeters" | "headingRadians">>
  ) => DifferentialDriveOdometryState;
  trackVelocity: (
    linearVelocityMps: number,
    angularVelocityRadPerSec: number,
    options?: ClosedLoopMotionOptions
  ) => ClosedLoopMotionState;
  driveDistance: (
    distanceMeters: number,
    options?: ClosedLoopMotionOptions
  ) => ClosedLoopMotionState;
  turnToHeading: (
    targetHeadingRadians: number,
    options?: ClosedLoopMotionOptions
  ) => ClosedLoopMotionState;
  turnByAngle: (
    deltaHeadingRadians: number,
    options?: ClosedLoopMotionOptions
  ) => ClosedLoopMotionState;
  cancelMotion: (reason?: string) => ClosedLoopMotionState;
  getMotionState: () => ClosedLoopMotionState;
  navigateToWaypoint: (
    waypoint: NavigationWaypoint,
    options?: WaypointNavigationOptions
  ) => WaypointNavigationState;
  navigateWaypoints: (
    waypoints: readonly NavigationWaypoint[],
    options?: WaypointNavigationOptions
  ) => WaypointNavigationState;
  pauseNavigation: () => WaypointNavigationState;
  resumeNavigation: () => WaypointNavigationState;
  cancelNavigation: (reason?: string) => WaypointNavigationState;
  resetNavigation: () => WaypointNavigationState;
  getNavigationState: () => WaypointNavigationState;
  configureObstacleAvoidance: (
    options?: ObstacleAvoidanceOptions
  ) => ObstacleAvoidanceState;
  getObstacleAvoidanceState: () => ObstacleAvoidanceState;
  resetObstacleAvoidance: () => ObstacleAvoidanceState;
}

export interface RobotControlRoutine {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly onStart?: (api: RobotControlApi) => void;
  readonly onResume?: (api: RobotControlApi) => void;
  readonly onTick: (ctx: RobotProgramStepContext, api: RobotControlApi) => void;
  readonly onStop?: (api: RobotControlApi) => void;
}

export interface RobotProgramControllerState {
  readonly controlSource: RobotControlSource;
  readonly programStatus: RobotProgramStatus;
  readonly activeProgramId: string | null;
  readonly activeProgramName: string | null;
  readonly leftPower: number;
  readonly rightPower: number;
  readonly binding: MotorHardwareBinding;
  readonly lastWarnings: readonly string[];
  readonly commandLogCount: number;
  readonly lastError: string | null;
  readonly executionTrace: VisualProgramExecutionTrace | null;
  readonly motion?: ClosedLoopMotionState;
  readonly navigation?: WaypointNavigationState;
  readonly avoidance?: ObstacleAvoidanceState;
}

export function buildProgramStepContext(
  telemetry: SimulationTelemetrySnapshot,
  dtSeconds: number,
  sensors?: RobotSensorsSnapshot,
  isSingleStep = false,
  odometry?: DifferentialDriveOdometryState,
  motion?: ClosedLoopMotionState,
  navigation?: WaypointNavigationState,
  avoidance?: ObstacleAvoidanceState
): RobotProgramStepContext {
  return {
    timeSeconds: telemetry.timeSeconds,
    dtSeconds,
    stepCount: telemetry.stepCount,
    pose: {
      xMeters: telemetry.xMeters,
      zMeters: telemetry.zMeters,
      headingRadians: telemetry.headingRadians,
      headingDegrees: telemetry.headingDegrees,
    },
    velocity: {
      longitudinalMps: telemetry.longitudinalVelocityMps,
      lateralMps: telemetry.lateralVelocityMps,
      yawRateRadPerSec: telemetry.yawRateRadPerSec,
    },
    battery: {
      terminalVoltageV: telemetry.batteryTerminalVoltageV,
      totalCurrentDrawA: telemetry.totalCurrentDrawA,
      isCutoff: telemetry.isBatteryCutoff,
    },
    collision: {
      hasCollision: telemetry.collision.hasCollision,
      contactCount: telemetry.collision.contactCount,
      collidedBarrierIds: telemetry.collision.collidedBarrierIds,
    },
    sensors,
    ...(odometry && { odometry }),
    ...(motion && { motion }),
    ...(navigation && { navigation }),
    ...(avoidance && { avoidance }),
    isSingleStep,
  };
}
