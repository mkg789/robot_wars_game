import type { SimulationTelemetrySnapshot } from "../../simulation/types/simulationTelemetry.types";
import type { DrivetrainType } from "../../robot-builder/types/robot.types";
import type {
  EncoderData,
  ImuData,
  IrProximityData,
  LineSensorData,
  RobotSensorsSnapshot,
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
}

export function buildProgramStepContext(
  telemetry: SimulationTelemetrySnapshot,
  dtSeconds: number,
  sensors?: RobotSensorsSnapshot,
  isSingleStep = false,
  odometry?: DifferentialDriveOdometryState
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
    isSingleStep,
  };
}
