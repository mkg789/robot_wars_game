import type { SimulationRobotConfig } from "../../simulation/types/simulation.types";
import type {
  ClosedLoopMotionKind,
  ClosedLoopMotionOptions,
  ClosedLoopMotionPidBundle,
  ClosedLoopMotionProgress,
  ClosedLoopMotionState,
  DifferentialDriveModel,
  DifferentialDriveOdometryState,
  DifferentialDriveResolution,
  MotorHardwareBinding,
  PidConfig,
} from "../types/control.types";
import { computeDifferentialDriveTargetsFromTwist } from "./differentialDriveControl";
import { PidController, validatePidConfig } from "./pidController";

const DEFAULT_DISTANCE_TOLERANCE_M = 0.02;
const DEFAULT_HEADING_TOLERANCE_RAD = 0.025;
const DEFAULT_LINEAR_SETTLE_SPEED_MPS = 0.05;
const DEFAULT_ANGULAR_SETTLE_SPEED_RAD_PER_SEC = 0.08;
const DEFAULT_SETTLE_STEPS = 3;
const DEFAULT_BOUNDED_TIMEOUT_SECONDS = 15.0;

const DEFAULT_LINEAR_VELOCITY_PID: PidConfig = {
  kp: 0.45,
  ki: 0.8,
  kd: 0.01,
  outputLimits: { min: -2.0, max: 2.0 },
  integralLimits: { min: -1.0, max: 1.0 },
  derivativeFilterTimeConstantSeconds: 0.02,
  derivativeMode: "measurement",
};

const DEFAULT_ANGULAR_VELOCITY_PID: PidConfig = {
  kp: 0.35,
  ki: 0.8,
  kd: 0.01,
  outputLimits: { min: -4.0, max: 4.0 },
  integralLimits: { min: -2.0, max: 2.0 },
  derivativeFilterTimeConstantSeconds: 0.02,
  derivativeMode: "measurement",
};

const DEFAULT_DISTANCE_PID: PidConfig = {
  kp: 2.2,
  ki: 0.15,
  kd: 0.12,
  integralLimits: { min: -0.4, max: 0.4 },
  derivativeFilterTimeConstantSeconds: 0.02,
  derivativeMode: "measurement",
};

const DEFAULT_HEADING_PID: PidConfig = {
  kp: 3.5,
  ki: 0.25,
  kd: 0.15,
  integralLimits: { min: -0.6, max: 0.6 },
  derivativeFilterTimeConstantSeconds: 0.02,
  derivativeMode: "measurement",
};

const ZERO_PROGRESS: ClosedLoopMotionProgress = Object.freeze({
  distanceTraveledMeters: 0,
  remainingDistanceMeters: 0,
  headingDeltaRadians: 0,
  headingErrorRadians: 0,
  linearVelocityErrorMps: 0,
  angularVelocityErrorRadPerSec: 0,
  settleCounter: 0,
});

function wrapAngleSigned(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  let angle = radians % (2 * Math.PI);
  if (angle > Math.PI) {
    angle -= 2 * Math.PI;
  } else if (angle <= -Math.PI) {
    angle += 2 * Math.PI;
  }
  return Object.is(angle, -0) ? 0 : angle;
}

function clampSigned(value: number, limit: number): number {
  if (!Number.isFinite(value) || limit <= 0) return 0;
  if (value > limit) return limit;
  if (value < -limit) return -limit;
  return Object.is(value, -0) ? 0 : value;
}

interface ResolvedMotionConfig {
  readonly maxLinearSpeedMps: number;
  readonly maxAngularSpeedRadPerSec: number;
  readonly distanceToleranceMeters: number;
  readonly headingToleranceRadians: number;
  readonly linearVelocityToleranceMps: number;
  readonly angularVelocityToleranceRadPerSec: number;
  readonly settleStepCount: number;
  readonly timeoutSeconds: number | null;
  readonly holdHeading: boolean;
  readonly linearVelocityPidConfig: PidConfig;
  readonly angularVelocityPidConfig: PidConfig;
  readonly distancePidConfig: PidConfig;
  readonly headingPidConfig: PidConfig;
  readonly errors: readonly string[];
}

function resolveMotionConfig(
  kind: ClosedLoopMotionKind,
  model: DifferentialDriveModel,
  options?: ClosedLoopMotionOptions
): ResolvedMotionConfig {
  const errors: string[] = [];

  const capLinear =
    model.maxLinearVelocityMps > 0 ? model.maxLinearVelocityMps : Number.POSITIVE_INFINITY;
  const capAngular =
    model.maxAngularVelocityRadPerSec > 0
      ? model.maxAngularVelocityRadPerSec
      : Number.POSITIVE_INFINITY;

  const requestedMaxLinear = options?.maxLinearSpeedMps;
  const requestedMaxAngular = options?.maxAngularSpeedRadPerSec;

  if (
    requestedMaxLinear !== undefined &&
    (!Number.isFinite(requestedMaxLinear) || requestedMaxLinear <= 0)
  ) {
    errors.push("maxLinearSpeedMps must be positive and finite.");
  }
  if (
    requestedMaxAngular !== undefined &&
    (!Number.isFinite(requestedMaxAngular) || requestedMaxAngular <= 0)
  ) {
    errors.push("maxAngularSpeedRadPerSec must be positive and finite.");
  }

  const maxLinearSpeedMps =
    requestedMaxLinear !== undefined
      ? Math.min(requestedMaxLinear, capLinear)
      : model.maxLinearVelocityMps;
  const maxAngularSpeedRadPerSec =
    requestedMaxAngular !== undefined
      ? Math.min(requestedMaxAngular, capAngular)
      : model.maxAngularVelocityRadPerSec;

  const distanceToleranceMeters =
    options?.distanceToleranceMeters ?? DEFAULT_DISTANCE_TOLERANCE_M;
  const headingToleranceRadians =
    options?.headingToleranceRadians ?? DEFAULT_HEADING_TOLERANCE_RAD;
  const linearVelocityToleranceMps =
    options?.linearVelocityToleranceMps ?? DEFAULT_LINEAR_SETTLE_SPEED_MPS;
  const angularVelocityToleranceRadPerSec =
    options?.angularVelocityToleranceRadPerSec ?? DEFAULT_ANGULAR_SETTLE_SPEED_RAD_PER_SEC;
  const settleStepCount = Math.max(
    1,
    Math.floor(options?.settleStepCount ?? DEFAULT_SETTLE_STEPS)
  );

  if (!Number.isFinite(distanceToleranceMeters) || distanceToleranceMeters <= 0) {
    errors.push("distanceToleranceMeters must be positive and finite.");
  }
  if (!Number.isFinite(headingToleranceRadians) || headingToleranceRadians <= 0) {
    errors.push("headingToleranceRadians must be positive and finite.");
  }
  if (!Number.isFinite(linearVelocityToleranceMps) || linearVelocityToleranceMps < 0) {
    errors.push("linearVelocityToleranceMps must be non-negative and finite.");
  }
  if (
    !Number.isFinite(angularVelocityToleranceRadPerSec) ||
    angularVelocityToleranceRadPerSec < 0
  ) {
    errors.push("angularVelocityToleranceRadPerSec must be non-negative and finite.");
  }

  let timeoutSeconds: number | null =
    options?.timeoutSeconds !== undefined
      ? options.timeoutSeconds
      : kind === "velocity-hold"
        ? null
        : DEFAULT_BOUNDED_TIMEOUT_SECONDS;

  if (timeoutSeconds !== null) {
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      errors.push("timeoutSeconds must be positive and finite when provided.");
      timeoutSeconds = null;
    }
  }

  const linearVelocityPidConfig: PidConfig = {
    ...DEFAULT_LINEAR_VELOCITY_PID,
    ...options?.linearVelocityPid,
  };
  const angularVelocityPidConfig: PidConfig = {
    ...DEFAULT_ANGULAR_VELOCITY_PID,
    ...options?.angularVelocityPid,
  };
  const distancePidConfig: PidConfig = {
    ...DEFAULT_DISTANCE_PID,
    ...options?.distancePid,
    ...(maxLinearSpeedMps > 0 && !options?.distancePid?.outputLimits
      ? { outputLimits: { min: -maxLinearSpeedMps, max: maxLinearSpeedMps } }
      : {}),
  };
  const headingPidConfig: PidConfig = {
    ...DEFAULT_HEADING_PID,
    ...options?.headingPid,
    ...(maxAngularSpeedRadPerSec > 0 && !options?.headingPid?.outputLimits
      ? {
          outputLimits: {
            min: -maxAngularSpeedRadPerSec,
            max: maxAngularSpeedRadPerSec,
          },
        }
      : {}),
  };

  for (const [label, cfg] of [
    ["linearVelocityPid", linearVelocityPidConfig],
    ["angularVelocityPid", angularVelocityPidConfig],
    ["distancePid", distancePidConfig],
    ["headingPid", headingPidConfig],
  ] as const) {
    const val = validatePidConfig(cfg);
    if (!val.isValid) {
      errors.push(`${label}: ${val.errors.join(" ")}`);
    }
  }

  return {
    maxLinearSpeedMps: Math.max(0, maxLinearSpeedMps),
    maxAngularSpeedRadPerSec: Math.max(0, maxAngularSpeedRadPerSec),
    distanceToleranceMeters,
    headingToleranceRadians,
    linearVelocityToleranceMps,
    angularVelocityToleranceRadPerSec,
    settleStepCount,
    timeoutSeconds,
    holdHeading: options?.holdHeading ?? true,
    linearVelocityPidConfig,
    angularVelocityPidConfig,
    distancePidConfig,
    headingPidConfig,
    errors,
  };
}

function capturePidBundle(
  linearVelocity: PidController,
  angularVelocity: PidController,
  distance: PidController,
  heading: PidController
): ClosedLoopMotionPidBundle {
  return {
    linearVelocity: linearVelocity.getState(),
    angularVelocity: angularVelocity.getState(),
    distance: distance.getState(),
    heading: heading.getState(),
  };
}

/**
 * Composable closed-loop motion controller orchestrating independent PID loops
 * with encoder odometry feedback and Phase 9.1 differential-drive saturation.
 * Strictly separated from physics ODE and ground-truth simulation pose.
 */
export class ClosedLoopMotionController {
  private linearVelocityPid = new PidController(DEFAULT_LINEAR_VELOCITY_PID);
  private angularVelocityPid = new PidController(DEFAULT_ANGULAR_VELOCITY_PID);
  private distancePid = new PidController(DEFAULT_DISTANCE_PID);
  private headingPid = new PidController(DEFAULT_HEADING_PID);

  private activeConfig: ResolvedMotionConfig | null = null;
  private startLeftDistanceM = 0;
  private startRightDistanceM = 0;
  private initialHeadingRad = 0;
  private lastWrappedHeadingRad = 0;
  private continuousHeadingRad = 0;
  private targetContinuousHeadingRad = 0;
  private state: ClosedLoopMotionState = this.createIdleState();

  private createIdleState(): ClosedLoopMotionState {
    return {
      kind: null,
      status: "idle",
      isActive: false,
      elapsedSeconds: 0,
      stepCount: 0,
      targetLinearVelocityMps: 0,
      targetAngularVelocityRadPerSec: 0,
      targetDistanceMeters: 0,
      targetHeadingRadians: 0,
      targetDeltaHeadingRadians: 0,
      progress: ZERO_PROGRESS,
      commandedTwist: {
        linearVelocityMps: 0,
        angularVelocityRadPerSec: 0,
      },
      lastResolution: null,
      pidStates: capturePidBundle(
        this.linearVelocityPid,
        this.angularVelocityPid,
        this.distancePid,
        this.headingPid
      ),
      warnings: [],
    };
  }

  private buildCompletedState(params: {
    readonly elapsedSeconds: number;
    readonly stepCount: number;
    readonly distanceTraveledMeters: number;
    readonly remainingDistanceMeters: number;
    readonly headingDeltaRadians: number;
    readonly headingErrorRadians: number;
    readonly settleCounter: number;
  }): ClosedLoopMotionState {
    return {
      ...this.state,
      status: "completed",
      isActive: false,
      elapsedSeconds: params.elapsedSeconds,
      stepCount: params.stepCount,
      progress: {
        distanceTraveledMeters: params.distanceTraveledMeters,
        remainingDistanceMeters: params.remainingDistanceMeters,
        headingDeltaRadians: params.headingDeltaRadians,
        headingErrorRadians: params.headingErrorRadians,
        linearVelocityErrorMps: 0,
        angularVelocityErrorRadPerSec: 0,
        settleCounter: params.settleCounter,
      },
      commandedTwist: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
      pidStates: capturePidBundle(
        this.linearVelocityPid,
        this.angularVelocityPid,
        this.distancePid,
        this.headingPid
      ),
    };
  }

  getState(): ClosedLoopMotionState {
    return this.state;
  }

  isActive(): boolean {
    return this.state.isActive;
  }

  private resetLoops(config?: ResolvedMotionConfig): void {
    this.linearVelocityPid = new PidController(
      config?.linearVelocityPidConfig ?? DEFAULT_LINEAR_VELOCITY_PID
    );
    this.angularVelocityPid = new PidController(
      config?.angularVelocityPidConfig ?? DEFAULT_ANGULAR_VELOCITY_PID
    );
    this.distancePid = new PidController(
      config?.distancePidConfig ?? DEFAULT_DISTANCE_PID
    );
    this.headingPid = new PidController(
      config?.headingPidConfig ?? DEFAULT_HEADING_PID
    );
  }

  private validatePrerequisites(params: {
    readonly kind: ClosedLoopMotionKind;
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
    readonly config: ResolvedMotionConfig;
  }): string | null {
    const { model, odometry, binding, config } = params;
    if (config.errors.length > 0) {
      return config.errors.join(" ");
    }
    if (!model.isValid || !model.left.isDrivable || !model.right.isDrivable) {
      return (
        model.errors[0] ??
        model.warnings[0] ??
        "Differential drivetrain cannot drive cleanly under current hardware configuration."
      );
    }
    if (!binding.canDrive) {
      return (
        binding.faultReason ??
        "Motor electrical hardware binding blocks closed-loop actuation."
      );
    }
    if (!odometry.isValid || odometry.status !== "ready") {
      return (
        odometry.error ??
        `Encoder odometry unavailable (${odometry.status}); cannot execute closed-loop motion safely.`
      );
    }
    return null;
  }

  private failImmediately(
    kind: ClosedLoopMotionKind,
    reason: string,
    params?: {
      readonly targetLinear?: number;
      readonly targetAngular?: number;
      readonly targetDistance?: number;
      readonly targetHeading?: number;
      readonly targetDelta?: number;
    }
  ): ClosedLoopMotionState {
    this.activeConfig = null;
    this.resetLoops();
    this.state = {
      kind,
      status: "failed",
      isActive: false,
      elapsedSeconds: 0,
      stepCount: 0,
      targetLinearVelocityMps: params?.targetLinear ?? 0,
      targetAngularVelocityRadPerSec: params?.targetAngular ?? 0,
      targetDistanceMeters: params?.targetDistance ?? 0,
      targetHeadingRadians: params?.targetHeading ?? 0,
      targetDeltaHeadingRadians: params?.targetDelta ?? 0,
      progress: ZERO_PROGRESS,
      commandedTwist: {
        linearVelocityMps: 0,
        angularVelocityRadPerSec: 0,
      },
      lastResolution: null,
      pidStates: capturePidBundle(
        this.linearVelocityPid,
        this.angularVelocityPid,
        this.distancePid,
        this.headingPid
      ),
      failureReason: reason,
      warnings: [reason],
    };
    return this.state;
  }

  startVelocityHold(params: {
    readonly linearVelocityMps: number;
    readonly angularVelocityRadPerSec: number;
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
    readonly options?: ClosedLoopMotionOptions;
  }): ClosedLoopMotionState {
    const {
      linearVelocityMps,
      angularVelocityRadPerSec,
      model,
      odometry,
      binding,
      options,
    } = params;

    if (
      !Number.isFinite(linearVelocityMps) ||
      !Number.isFinite(angularVelocityRadPerSec)
    ) {
      return this.failImmediately(
        "velocity-hold",
        "Velocity hold target must be finite."
      );
    }

    const config = resolveMotionConfig("velocity-hold", model, options);
    const prereqErr = this.validatePrerequisites({
      kind: "velocity-hold",
      model,
      odometry,
      binding,
      config,
    });
    if (prereqErr) {
      return this.failImmediately("velocity-hold", prereqErr, {
        targetLinear: linearVelocityMps,
        targetAngular: angularVelocityRadPerSec,
      });
    }

    const boundedLinear = clampSigned(linearVelocityMps, config.maxLinearSpeedMps);
    const boundedAngular = clampSigned(
      angularVelocityRadPerSec,
      config.maxAngularSpeedRadPerSec
    );
    const warnings: string[] = [];
    if (
      Math.abs(boundedLinear - linearVelocityMps) > 1e-6 ||
      Math.abs(boundedAngular - angularVelocityRadPerSec) > 1e-6
    ) {
      warnings.push(
        "Requested velocity target exceeded configured or physical limits and was bounded."
      );
    }

    this.activeConfig = config;
    this.resetLoops(config);
    this.lastWrappedHeadingRad = odometry.pose.headingRadians;
    this.continuousHeadingRad = odometry.pose.headingRadians;
    this.state = {
      kind: "velocity-hold",
      status: "running",
      isActive: true,
      elapsedSeconds: 0,
      stepCount: 0,
      targetLinearVelocityMps: boundedLinear,
      targetAngularVelocityRadPerSec: boundedAngular,
      targetDistanceMeters: 0,
      targetHeadingRadians: 0,
      targetDeltaHeadingRadians: 0,
      progress: {
        ...ZERO_PROGRESS,
        linearVelocityErrorMps: boundedLinear - odometry.velocity.linearVelocityMps,
        angularVelocityErrorRadPerSec:
          boundedAngular - odometry.velocity.angularVelocityRadPerSec,
      },
      commandedTwist: {
        linearVelocityMps: boundedLinear,
        angularVelocityRadPerSec: boundedAngular,
      },
      lastResolution: null,
      pidStates: capturePidBundle(
        this.linearVelocityPid,
        this.angularVelocityPid,
        this.distancePid,
        this.headingPid
      ),
      warnings,
    };
    return this.state;
  }

  /**
   * Updates active velocity-hold linear and angular targets smoothly without
   * resetting inner PID integrators or derivative filter history.
   */
  updateVelocityHoldTargets(params: {
    readonly linearVelocityMps: number;
    readonly angularVelocityRadPerSec: number;
  }): ClosedLoopMotionState {
    if (
      this.state.kind !== "velocity-hold" ||
      this.state.status !== "running" ||
      !this.state.isActive ||
      !this.activeConfig
    ) {
      return this.state;
    }

    const { linearVelocityMps, angularVelocityRadPerSec } = params;
    if (
      !Number.isFinite(linearVelocityMps) ||
      !Number.isFinite(angularVelocityRadPerSec)
    ) {
      return this.failImmediately(
        "velocity-hold",
        "Velocity hold target must be finite."
      );
    }

    const boundedLinear = clampSigned(
      linearVelocityMps,
      this.activeConfig.maxLinearSpeedMps
    );
    const boundedAngular = clampSigned(
      angularVelocityRadPerSec,
      this.activeConfig.maxAngularSpeedRadPerSec
    );

    this.state = {
      ...this.state,
      targetLinearVelocityMps: boundedLinear,
      targetAngularVelocityRadPerSec: boundedAngular,
    };
    return this.state;
  }

  startDriveDistance(params: {
    readonly distanceMeters: number;
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
    readonly options?: ClosedLoopMotionOptions;
  }): ClosedLoopMotionState {
    const { distanceMeters, model, odometry, binding, options } = params;
    if (!Number.isFinite(distanceMeters)) {
      return this.failImmediately(
        "drive-distance",
        "Drive distance target must be finite."
      );
    }

    const config = resolveMotionConfig("drive-distance", model, options);
    const prereqErr = this.validatePrerequisites({
      kind: "drive-distance",
      model,
      odometry,
      binding,
      config,
    });
    if (prereqErr) {
      return this.failImmediately("drive-distance", prereqErr, {
        targetDistance: distanceMeters,
      });
    }

    this.activeConfig = config;
    this.resetLoops(config);
    this.startLeftDistanceM = odometry.leftDistanceMeters;
    this.startRightDistanceM = odometry.rightDistanceMeters;
    this.initialHeadingRad = odometry.pose.headingRadians;
    this.lastWrappedHeadingRad = odometry.pose.headingRadians;
    this.continuousHeadingRad = odometry.pose.headingRadians;
    this.targetContinuousHeadingRad = odometry.pose.headingRadians;

    const alreadyAtTarget =
      Math.abs(distanceMeters) <= config.distanceToleranceMeters &&
      Math.abs(odometry.velocity.linearVelocityMps) <= config.linearVelocityToleranceMps;

    this.state = {
      kind: "drive-distance",
      status: alreadyAtTarget ? "completed" : "running",
      isActive: !alreadyAtTarget,
      elapsedSeconds: 0,
      stepCount: 0,
      targetLinearVelocityMps: 0,
      targetAngularVelocityRadPerSec: 0,
      targetDistanceMeters: distanceMeters,
      targetHeadingRadians: this.initialHeadingRad,
      targetDeltaHeadingRadians: 0,
      progress: {
        distanceTraveledMeters: 0,
        remainingDistanceMeters: distanceMeters,
        headingDeltaRadians: 0,
        headingErrorRadians: 0,
        linearVelocityErrorMps: 0,
        angularVelocityErrorRadPerSec: 0,
        settleCounter: alreadyAtTarget ? config.settleStepCount : 0,
      },
      commandedTwist: {
        linearVelocityMps: 0,
        angularVelocityRadPerSec: 0,
      },
      lastResolution: null,
      pidStates: capturePidBundle(
        this.linearVelocityPid,
        this.angularVelocityPid,
        this.distancePid,
        this.headingPid
      ),
      warnings: [],
    };
    return this.state;
  }

  private startHeadingMotion(params: {
    readonly kind: "turn-to-heading" | "relative-turn";
    readonly deltaRadians: number;
    readonly targetHeadingRad: number;
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
    readonly options?: ClosedLoopMotionOptions;
  }): ClosedLoopMotionState {
    const {
      kind,
      deltaRadians,
      targetHeadingRad,
      model,
      odometry,
      binding,
      options,
    } = params;

    const config = resolveMotionConfig(kind, model, options);
    const prereqErr = this.validatePrerequisites({
      kind,
      model,
      odometry,
      binding,
      config,
    });
    if (prereqErr) {
      return this.failImmediately(kind, prereqErr, {
        targetHeading: targetHeadingRad,
        targetDelta: deltaRadians,
      });
    }

    this.activeConfig = config;
    this.resetLoops(config);
    this.initialHeadingRad = odometry.pose.headingRadians;
    this.lastWrappedHeadingRad = odometry.pose.headingRadians;
    this.continuousHeadingRad = odometry.pose.headingRadians;
    this.targetContinuousHeadingRad = this.continuousHeadingRad + deltaRadians;

    const alreadyAtTarget =
      Math.abs(deltaRadians) <= config.headingToleranceRadians &&
      Math.abs(odometry.velocity.angularVelocityRadPerSec) <=
        config.angularVelocityToleranceRadPerSec;

    this.state = {
      kind,
      status: alreadyAtTarget ? "completed" : "running",
      isActive: !alreadyAtTarget,
      elapsedSeconds: 0,
      stepCount: 0,
      targetLinearVelocityMps: 0,
      targetAngularVelocityRadPerSec: 0,
      targetDistanceMeters: 0,
      targetHeadingRadians: wrapAngleSigned(targetHeadingRad),
      targetDeltaHeadingRadians: deltaRadians,
      progress: {
        distanceTraveledMeters: 0,
        remainingDistanceMeters: 0,
        headingDeltaRadians: 0,
        headingErrorRadians: deltaRadians,
        linearVelocityErrorMps: 0,
        angularVelocityErrorRadPerSec: 0,
        settleCounter: alreadyAtTarget ? config.settleStepCount : 0,
      },
      commandedTwist: {
        linearVelocityMps: 0,
        angularVelocityRadPerSec: 0,
      },
      lastResolution: null,
      pidStates: capturePidBundle(
        this.linearVelocityPid,
        this.angularVelocityPid,
        this.distancePid,
        this.headingPid
      ),
      warnings: [],
    };
    return this.state;
  }

  startTurnToHeading(params: {
    readonly targetHeadingRadians: number;
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
    readonly options?: ClosedLoopMotionOptions;
  }): ClosedLoopMotionState {
    if (!Number.isFinite(params.targetHeadingRadians)) {
      return this.failImmediately(
        "turn-to-heading",
        "Target heading must be finite."
      );
    }
    const normalizedTarget = wrapAngleSigned(params.targetHeadingRadians);
    const delta = wrapAngleSigned(
      normalizedTarget - params.odometry.pose.headingRadians
    );
    return this.startHeadingMotion({
      kind: "turn-to-heading",
      deltaRadians: delta,
      targetHeadingRad: normalizedTarget,
      model: params.model,
      odometry: params.odometry,
      binding: params.binding,
      options: params.options,
    });
  }

  startRelativeTurn(params: {
    readonly deltaHeadingRadians: number;
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
    readonly options?: ClosedLoopMotionOptions;
  }): ClosedLoopMotionState {
    if (!Number.isFinite(params.deltaHeadingRadians)) {
      return this.failImmediately(
        "relative-turn",
        "Relative turn angle must be finite."
      );
    }
    return this.startHeadingMotion({
      kind: "relative-turn",
      deltaRadians: params.deltaHeadingRadians,
      targetHeadingRad: wrapAngleSigned(
        params.odometry.pose.headingRadians + params.deltaHeadingRadians
      ),
      model: params.model,
      odometry: params.odometry,
      binding: params.binding,
      options: params.options,
    });
  }

  cancel(reason = "Motion cancelled."): ClosedLoopMotionState {
    if (!this.state.isActive) {
      return this.state;
    }
    this.activeConfig = null;
    this.resetLoops();
    this.state = {
      ...this.state,
      status: "cancelled",
      isActive: false,
      commandedTwist: {
        linearVelocityMps: 0,
        angularVelocityRadPerSec: 0,
      },
      warnings: [...this.state.warnings, reason],
    };
    return this.state;
  }

  reset(): ClosedLoopMotionState {
    this.activeConfig = null;
    this.resetLoops();
    this.startLeftDistanceM = 0;
    this.startRightDistanceM = 0;
    this.initialHeadingRad = 0;
    this.lastWrappedHeadingRad = 0;
    this.continuousHeadingRad = 0;
    this.targetContinuousHeadingRad = 0;
    this.state = this.createIdleState();
    return this.state;
  }

  step(params: {
    readonly dtSeconds: number;
    readonly odometry: DifferentialDriveOdometryState;
    readonly model: DifferentialDriveModel;
    readonly binding: MotorHardwareBinding;
    readonly robotConfig?: SimulationRobotConfig | null;
  }): {
    readonly state: ClosedLoopMotionState;
    readonly leftThrottle: number;
    readonly rightThrottle: number;
  } {
    const { dtSeconds, odometry, model, binding, robotConfig } = params;

    if (!this.state.isActive || !this.activeConfig || !this.state.kind) {
      return {
        state: this.state,
        leftThrottle: 0,
        rightThrottle: 0,
      };
    }

    const kind = this.state.kind;
    const config = this.activeConfig;

    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return {
        state: this.state,
        leftThrottle: 0,
        rightThrottle: 0,
      };
    }

    const prereqErr = this.validatePrerequisites({
      kind,
      model,
      odometry,
      binding,
      config,
    });
    if (prereqErr) {
      this.activeConfig = null;
      this.state = {
        ...this.state,
        status: "failed",
        isActive: false,
        commandedTwist: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
        pidStates: capturePidBundle(
          this.linearVelocityPid,
          this.angularVelocityPid,
          this.distancePid,
          this.headingPid
        ),
        failureReason: prereqErr,
        warnings: [...this.state.warnings, prereqErr],
      };
      return { state: this.state, leftThrottle: 0, rightThrottle: 0 };
    }

    const elapsedSeconds = this.state.elapsedSeconds + dtSeconds;
    const stepCount = this.state.stepCount + 1;

    if (
      config.timeoutSeconds !== null &&
      elapsedSeconds >= config.timeoutSeconds
    ) {
      const timeoutMsg = `Motion "${kind}" timed out after ${config.timeoutSeconds.toFixed(2)}s.`;
      this.activeConfig = null;
      this.state = {
        ...this.state,
        status: "timed-out",
        isActive: false,
        elapsedSeconds,
        stepCount,
        commandedTwist: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
        warnings: [...this.state.warnings, timeoutMsg],
      };
      return { state: this.state, leftThrottle: 0, rightThrottle: 0 };
    }

    // Track unwrapped heading cleanly across (-pi, pi] transitions
    const wrappedHeading = odometry.pose.headingRadians;
    const headingIncrement = wrapAngleSigned(
      wrappedHeading - this.lastWrappedHeadingRad
    );
    this.continuousHeadingRad += headingIncrement;
    this.lastWrappedHeadingRad = wrappedHeading;

    const distanceTraveledMeters =
      ((odometry.leftDistanceMeters - this.startLeftDistanceM) +
        (odometry.rightDistanceMeters - this.startRightDistanceM)) *
      0.5;
    const headingDeltaRadians =
      this.continuousHeadingRad - this.initialHeadingRad;

    let targetLinearVel = this.state.targetLinearVelocityMps;
    let targetAngularVel = this.state.targetAngularVelocityRadPerSec;
    let remainingDistanceMeters = 0;
    let headingErrorRadians = 0;
    let nextSettleCounter = this.state.progress.settleCounter;

    if (kind === "drive-distance") {
      remainingDistanceMeters =
        this.state.targetDistanceMeters - distanceTraveledMeters;
      headingErrorRadians =
        this.targetContinuousHeadingRad - this.continuousHeadingRad;

      const withinDist =
        Math.abs(remainingDistanceMeters) <= config.distanceToleranceMeters &&
        Math.abs(odometry.velocity.linearVelocityMps) <=
          config.linearVelocityToleranceMps;
      nextSettleCounter = withinDist ? nextSettleCounter + 1 : 0;

      if (nextSettleCounter >= config.settleStepCount) {
        this.state = this.buildCompletedState({
          elapsedSeconds,
          stepCount,
          distanceTraveledMeters,
          remainingDistanceMeters,
          headingDeltaRadians,
          headingErrorRadians,
          settleCounter: nextSettleCounter,
        });
        this.activeConfig = null;
        return { state: this.state, leftThrottle: 0, rightThrottle: 0 };
      }

      const distOut = this.distancePid.update(
        this.state.targetDistanceMeters,
        distanceTraveledMeters,
        dtSeconds
      );
      targetLinearVel = clampSigned(distOut.output, config.maxLinearSpeedMps);

      if (config.holdHeading) {
        const headingOut = this.headingPid.update(
          this.targetContinuousHeadingRad,
          this.continuousHeadingRad,
          dtSeconds
        );
        targetAngularVel = clampSigned(
          headingOut.output,
          config.maxAngularSpeedRadPerSec
        );
      } else {
        targetAngularVel = 0;
      }
    } else if (kind === "turn-to-heading" || kind === "relative-turn") {
      headingErrorRadians =
        this.targetContinuousHeadingRad - this.continuousHeadingRad;
      const withinHeading =
        Math.abs(headingErrorRadians) <= config.headingToleranceRadians &&
        Math.abs(odometry.velocity.angularVelocityRadPerSec) <=
          config.angularVelocityToleranceRadPerSec;
      nextSettleCounter = withinHeading ? nextSettleCounter + 1 : 0;

      if (nextSettleCounter >= config.settleStepCount) {
        this.state = this.buildCompletedState({
          elapsedSeconds,
          stepCount,
          distanceTraveledMeters: 0,
          remainingDistanceMeters: 0,
          headingDeltaRadians,
          headingErrorRadians,
          settleCounter: nextSettleCounter,
        });
        this.activeConfig = null;
        return { state: this.state, leftThrottle: 0, rightThrottle: 0 };
      }

      targetLinearVel = 0;
      const headingOut = this.headingPid.update(
        this.targetContinuousHeadingRad,
        this.continuousHeadingRad,
        dtSeconds
      );
      targetAngularVel = clampSigned(
        headingOut.output,
        config.maxAngularSpeedRadPerSec
      );
    }

    // Inner closed-loop velocity PIDs: feedforward twist target + velocity feedback trim
    const linearVelOut = this.linearVelocityPid.update(
      targetLinearVel,
      odometry.velocity.linearVelocityMps,
      dtSeconds
    );
    const angularVelOut = this.angularVelocityPid.update(
      targetAngularVel,
      odometry.velocity.angularVelocityRadPerSec,
      dtSeconds
    );

    const cmdLinear =
      Math.abs(targetLinearVel) < 1e-6 &&
      (kind === "turn-to-heading" || kind === "relative-turn")
        ? 0
        : clampSigned(
            targetLinearVel + linearVelOut.output,
            config.maxLinearSpeedMps > 0 ? config.maxLinearSpeedMps * 1.25 : 10
          );
    const cmdAngular = clampSigned(
      targetAngularVel + angularVelOut.output,
      config.maxAngularSpeedRadPerSec > 0
        ? config.maxAngularSpeedRadPerSec * 1.25
        : 20
    );

    const resolution: DifferentialDriveResolution =
      computeDifferentialDriveTargetsFromTwist({
        model,
        command: {
          linearVelocityMps: cmdLinear,
          angularVelocityRadPerSec: cmdAngular,
        },
        robotConfig,
      });

    this.state = {
      ...this.state,
      status: "running",
      isActive: true,
      elapsedSeconds,
      stepCount,
      progress: {
        distanceTraveledMeters,
        remainingDistanceMeters,
        headingDeltaRadians,
        headingErrorRadians,
        linearVelocityErrorMps:
          targetLinearVel - odometry.velocity.linearVelocityMps,
        angularVelocityErrorRadPerSec:
          targetAngularVel - odometry.velocity.angularVelocityRadPerSec,
        settleCounter: nextSettleCounter,
      },
      commandedTwist: {
        linearVelocityMps: resolution.achievedLinearVelocityMps,
        angularVelocityRadPerSec: resolution.achievedAngularVelocityRadPerSec,
      },
      lastResolution: resolution,
      pidStates: capturePidBundle(
        this.linearVelocityPid,
        this.angularVelocityPid,
        this.distancePid,
        this.headingPid
      ),
      warnings: resolution.warnings,
    };

    return {
      state: this.state,
      leftThrottle: resolution.leftThrottle,
      rightThrottle: resolution.rightThrottle,
    };
  }
}
