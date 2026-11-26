import type { SimulationTelemetrySnapshot } from "../../simulation/types/simulationWorld.types";

export type RobotControlSource = "manual" | "program" | "autonomous";

export type RobotProgramStatus =
  | "idle"
  | "running"
  | "stopped"
  | "fault"
  | "completed";

export type MotorChannelTarget = "left" | "right" | "both";

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
  /** Extension slot for future sensors (Phase 6.1+) without breaking API contracts. */
  readonly sensors?: Readonly<Record<string, unknown>>;
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
  stopMotors: (target?: MotorChannelTarget) => CommandNormalizationResult;
  stopRobot: () => CommandNormalizationResult;
  dispatchCommand: (command: RobotActuatorCommand) => CommandNormalizationResult;
  completeProgram: () => void;
}

export interface RobotControlRoutine {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly onStart?: (api: RobotControlApi) => void;
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
}

export function buildProgramStepContext(
  telemetry: SimulationTelemetrySnapshot,
  dtSeconds: number
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
  };
}
