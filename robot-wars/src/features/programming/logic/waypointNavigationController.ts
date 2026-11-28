import type {
  DifferentialDriveModel,
  DifferentialDriveOdometryState,
  MotorHardwareBinding,
  NavigationWaypoint,
  WaypointNavigationOptions,
  WaypointNavigationState,
} from "../types/control.types";
import type { ClosedLoopMotionController } from "./closedLoopMotionController";

const DEFAULT_ACCEPTANCE_RADIUS_M = 0.12;
const DEFAULT_HEADING_TOLERANCE_RAD = 0.16;
const DEFAULT_TURN_IN_PLACE_THRESHOLD_RAD = 0.55;
const DEFAULT_HEADING_GAIN = 3.0;
const DEFAULT_APPROACH_GAIN = 2.2;
const DEFAULT_NAVIGATION_TIMEOUT_SECONDS = 30.0;
const MIN_ALIGNED_APPROACH_SPEED_MPS = 0.22;
const MIN_INTERMEDIATE_APPROACH_SPEED_MPS = 0.35;

export function wrapNavigationAngleSigned(radians: number): number {
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

interface ResolvedNavigationConfig {
  readonly acceptanceRadiusMeters: number;
  readonly headingToleranceRadians: number;
  readonly turnInPlaceThresholdRadians: number;
  readonly maxLinearSpeedMps: number;
  readonly maxAngularSpeedRadPerSec: number;
  readonly headingGain: number;
  readonly approachGain: number;
  readonly timeoutSeconds: number | null;
  readonly rawOptions?: WaypointNavigationOptions;
  readonly errors: readonly string[];
}

function resolveNavigationConfig(
  model: DifferentialDriveModel,
  options?: WaypointNavigationOptions
): ResolvedNavigationConfig {
  const errors: string[] = [];

  const acceptanceRadiusMeters =
    options?.acceptanceRadiusMeters ?? DEFAULT_ACCEPTANCE_RADIUS_M;
  if (!Number.isFinite(acceptanceRadiusMeters) || acceptanceRadiusMeters <= 0) {
    errors.push("acceptanceRadiusMeters must be positive and finite.");
  }

  const headingToleranceRadians =
    options?.headingToleranceRadians ?? DEFAULT_HEADING_TOLERANCE_RAD;
  if (!Number.isFinite(headingToleranceRadians) || headingToleranceRadians <= 0) {
    errors.push("headingToleranceRadians must be positive and finite.");
  }

  const turnInPlaceThresholdRadians =
    options?.turnInPlaceThresholdRadians ??
    Math.max(headingToleranceRadians * 2.5, DEFAULT_TURN_IN_PLACE_THRESHOLD_RAD);
  if (
    !Number.isFinite(turnInPlaceThresholdRadians) ||
    turnInPlaceThresholdRadians <= headingToleranceRadians
  ) {
    errors.push(
      "turnInPlaceThresholdRadians must be finite and greater than headingToleranceRadians."
    );
  }

  const defaultMaxLinear =
    model.maxLinearVelocityMps > 0
      ? Math.min(1.0, model.maxLinearVelocityMps)
      : 0;
  const reqLinear = options?.maxLinearSpeedMps;
  if (reqLinear !== undefined && (!Number.isFinite(reqLinear) || reqLinear <= 0)) {
    errors.push("maxLinearSpeedMps must be positive and finite.");
  }
  const maxLinearSpeedMps =
    reqLinear !== undefined
      ? Math.min(
          reqLinear,
          model.maxLinearVelocityMps > 0 ? model.maxLinearVelocityMps : reqLinear
        )
      : defaultMaxLinear;

  const defaultMaxAngular =
    model.maxAngularVelocityRadPerSec > 0
      ? Math.min(3.5, model.maxAngularVelocityRadPerSec)
      : 0;
  const reqAngular = options?.maxAngularSpeedRadPerSec;
  if (reqAngular !== undefined && (!Number.isFinite(reqAngular) || reqAngular <= 0)) {
    errors.push("maxAngularSpeedRadPerSec must be positive and finite.");
  }
  const maxAngularSpeedRadPerSec =
    reqAngular !== undefined
      ? Math.min(
          reqAngular,
          model.maxAngularVelocityRadPerSec > 0
            ? model.maxAngularVelocityRadPerSec
            : reqAngular
        )
      : defaultMaxAngular;

  const headingGain = options?.headingGain ?? DEFAULT_HEADING_GAIN;
  if (!Number.isFinite(headingGain) || headingGain <= 0) {
    errors.push("headingGain must be positive and finite.");
  }

  const approachGain = options?.approachGain ?? DEFAULT_APPROACH_GAIN;
  if (!Number.isFinite(approachGain) || approachGain <= 0) {
    errors.push("approachGain must be positive and finite.");
  }

  const timeoutSeconds =
    options?.timeoutSeconds !== undefined
      ? options.timeoutSeconds
      : DEFAULT_NAVIGATION_TIMEOUT_SECONDS;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    errors.push("timeoutSeconds must be positive and finite.");
  }

  return {
    acceptanceRadiusMeters,
    headingToleranceRadians,
    turnInPlaceThresholdRadians,
    maxLinearSpeedMps,
    maxAngularSpeedRadPerSec,
    headingGain,
    approachGain,
    timeoutSeconds,
    rawOptions: options,
    errors,
  };
}

function validateWaypoints(
  waypoints: readonly NavigationWaypoint[]
): { readonly normalized: readonly NavigationWaypoint[]; readonly error: string | null } {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return {
      normalized: [],
      error: "Navigation requires at least one valid planar waypoint.",
    };
  }
  const normalized: NavigationWaypoint[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (
      !wp ||
      !Number.isFinite(wp.xMeters) ||
      !Number.isFinite(wp.zMeters)
    ) {
      return {
        normalized: [],
        error: `Waypoint at index ${i} must have finite xMeters and zMeters coordinates.`,
      };
    }
    normalized.push({
      xMeters: Object.is(wp.xMeters, -0) ? 0 : wp.xMeters,
      zMeters: Object.is(wp.zMeters, -0) ? 0 : wp.zMeters,
      ...(wp.label !== undefined ? { label: wp.label } : {}),
    });
  }
  return { normalized, error: null };
}

function computeTargetGeometry(
  odometry: DifferentialDriveOdometryState,
  target: NavigationWaypoint
): {
  readonly distanceMeters: number;
  readonly desiredHeadingRadians: number;
  readonly headingErrorRadians: number;
} {
  const dx = target.xMeters - odometry.pose.xMeters;
  const dz = target.zMeters - odometry.pose.zMeters;
  const distanceMeters = Math.hypot(dx, dz);
  const desiredHeadingRadians =
    distanceMeters > 1e-9
      ? wrapNavigationAngleSigned(Math.atan2(dz, dx))
      : odometry.pose.headingRadians;
  const headingErrorRadians = wrapNavigationAngleSigned(
    desiredHeadingRadians - odometry.pose.headingRadians
  );
  return {
    distanceMeters,
    desiredHeadingRadians,
    headingErrorRadians,
  };
}

/**
 * Pure deterministic differential-drive waypoint navigation engine operating exclusively
 * on encoder-odometry poses in the arena's X/Z plane (+X forward, +Z left, +Y CCW) and
 * executing actuation through ClosedLoopMotionController.
 */
export class WaypointNavigationController {
  private activeConfig: ResolvedNavigationConfig | null = null;
  private state: WaypointNavigationState = this.createIdleState();

  private createIdleState(): WaypointNavigationState {
    return {
      status: "idle",
      isActive: false,
      waypoints: [],
      currentWaypointIndex: -1,
      totalWaypoints: 0,
      completedWaypoints: 0,
      currentTarget: null,
      estimatedDistanceMeters: 0,
      estimatedHeadingRadians: 0,
      desiredHeadingRadians: 0,
      headingErrorRadians: 0,
      targetLinearVelocityMps: 0,
      targetAngularVelocityRadPerSec: 0,
      acceptanceRadiusMeters: DEFAULT_ACCEPTANCE_RADIUS_M,
      elapsedSeconds: 0,
      stepCount: 0,
      warnings: [],
    };
  }

  getState(): WaypointNavigationState {
    return this.state;
  }

  isActive(): boolean {
    return this.state.isActive;
  }

  private validatePrerequisites(params: {
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
    readonly config: ResolvedNavigationConfig;
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
        "Motor electrical hardware binding blocks waypoint navigation."
      );
    }
    if (!odometry.isValid || odometry.status !== "ready") {
      return (
        odometry.error ??
        `Encoder odometry unavailable (${odometry.status}); cannot execute waypoint navigation safely.`
      );
    }
    if (
      !Number.isFinite(odometry.pose.xMeters) ||
      !Number.isFinite(odometry.pose.zMeters) ||
      !Number.isFinite(odometry.pose.headingRadians)
    ) {
      return "Odometry pose estimate contains non-finite values.";
    }
    return null;
  }

  private failNavigation(
    reason: string,
    motionController?: ClosedLoopMotionController
  ): WaypointNavigationState {
    motionController?.cancel(`Navigation failed: ${reason}`);
    this.activeConfig = null;
    this.state = {
      ...this.state,
      status: "failed",
      isActive: false,
      targetLinearVelocityMps: 0,
      targetAngularVelocityRadPerSec: 0,
      failureReason: reason,
      warnings: [...this.state.warnings, reason],
    };
    return this.state;
  }

  private startVelocityHoldLoop(params: {
    readonly motionController: ClosedLoopMotionController;
    readonly config: ResolvedNavigationConfig;
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
  }): boolean {
    const motionState = params.motionController.startVelocityHold({
      linearVelocityMps: 0,
      angularVelocityRadPerSec: 0,
      model: params.model,
      odometry: params.odometry,
      binding: params.binding,
      options: {
        maxLinearSpeedMps: params.config.maxLinearSpeedMps,
        maxAngularSpeedRadPerSec: params.config.maxAngularSpeedRadPerSec,
        linearVelocityPid: params.config.rawOptions?.linearVelocityPid,
        angularVelocityPid: params.config.rawOptions?.angularVelocityPid,
      },
    });
    if (!motionState.isActive) {
      this.failNavigation(
        motionState.failureReason ??
          "Closed-loop velocity controller failed to initialize for navigation."
      );
      return false;
    }
    return true;
  }

  private computeGuidanceCommand(params: {
    readonly config: ResolvedNavigationConfig;
    readonly odometry: DifferentialDriveOdometryState;
    readonly waypointIndex: number;
    readonly waypoints: readonly NavigationWaypoint[];
  }): {
    readonly distanceMeters: number;
    readonly desiredHeadingRadians: number;
    readonly headingErrorRadians: number;
    readonly targetLinearVelocityMps: number;
    readonly targetAngularVelocityRadPerSec: number;
  } {
    const { config, odometry, waypointIndex, waypoints } = params;
    const target = waypoints[waypointIndex]!;
    const geom = computeTargetGeometry(odometry, target);

    const targetAngularVelocityRadPerSec = clampSigned(
      config.headingGain * geom.headingErrorRadians,
      config.maxAngularSpeedRadPerSec
    );

    const absErr = Math.abs(geom.headingErrorRadians);
    let alignScale = 1.0;
    if (absErr >= config.turnInPlaceThresholdRadians) {
      alignScale = 0;
    } else if (absErr > config.headingToleranceRadians) {
      const span =
        config.turnInPlaceThresholdRadians - config.headingToleranceRadians;
      alignScale =
        span > 1e-6
          ? Math.max(
              0,
              1 - (absErr - config.headingToleranceRadians) / span
            )
          : 0;
    }

    const hasNextWaypoint = waypointIndex + 1 < waypoints.length;
    let minApproachSpeed = MIN_ALIGNED_APPROACH_SPEED_MPS;
    if (hasNextWaypoint) {
      const nextWp = waypoints[waypointIndex + 1]!;
      const nextAngle = Math.atan2(
        nextWp.zMeters - target.zMeters,
        nextWp.xMeters - target.xMeters
      );
      const legTurnAngle = Math.abs(
        wrapNavigationAngleSigned(nextAngle - geom.desiredHeadingRadians)
      );
      if (legTurnAngle < 0.7) {
        minApproachSpeed = MIN_INTERMEDIATE_APPROACH_SPEED_MPS;
      }
    }

    const baseLinearSpeed = Math.min(
      config.maxLinearSpeedMps,
      Math.max(
        Math.min(config.maxLinearSpeedMps, minApproachSpeed),
        geom.distanceMeters * config.approachGain
      )
    );

    const targetLinearVelocityMps = clampSigned(
      baseLinearSpeed * alignScale,
      config.maxLinearSpeedMps
    );

    return {
      distanceMeters: geom.distanceMeters,
      desiredHeadingRadians: geom.desiredHeadingRadians,
      headingErrorRadians: geom.headingErrorRadians,
      targetLinearVelocityMps,
      targetAngularVelocityRadPerSec,
    };
  }

  startNavigation(params: {
    readonly waypoints: readonly NavigationWaypoint[];
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
    readonly motionController: ClosedLoopMotionController;
    readonly options?: WaypointNavigationOptions;
  }): WaypointNavigationState {
    const wpValidation = validateWaypoints(params.waypoints);
    if (wpValidation.error) {
      this.state = {
        ...this.createIdleState(),
        status: "failed",
        failureReason: wpValidation.error,
        warnings: [wpValidation.error],
      };
      params.motionController.cancel(wpValidation.error);
      this.activeConfig = null;
      return this.state;
    }

    const config = resolveNavigationConfig(params.model, params.options);
    const prereqErr = this.validatePrerequisites({
      model: params.model,
      odometry: params.odometry,
      binding: params.binding,
      config,
    });

    if (prereqErr) {
      this.state = {
        ...this.createIdleState(),
        waypoints: wpValidation.normalized,
        totalWaypoints: wpValidation.normalized.length,
        acceptanceRadiusMeters: Number.isFinite(config.acceptanceRadiusMeters)
          ? config.acceptanceRadiusMeters
          : DEFAULT_ACCEPTANCE_RADIUS_M,
        status: "failed",
        failureReason: prereqErr,
        warnings: [prereqErr],
      };
      params.motionController.cancel(prereqErr);
      this.activeConfig = null;
      return this.state;
    }

    // Advance immediately past any initial waypoints already inside acceptance radius
    const waypoints = wpValidation.normalized;
    let index = 0;
    while (index < waypoints.length) {
      const geom = computeTargetGeometry(params.odometry, waypoints[index]!);
      if (geom.distanceMeters <= config.acceptanceRadiusMeters) {
        index += 1;
      } else {
        break;
      }
    }

    if (index >= waypoints.length) {
      params.motionController.cancel("All waypoints already within acceptance radius.");
      this.activeConfig = null;
      const finalTarget = waypoints[waypoints.length - 1]!;
      const geom = computeTargetGeometry(params.odometry, finalTarget);
      this.state = {
        status: "completed",
        isActive: false,
        waypoints,
        currentWaypointIndex: waypoints.length - 1,
        totalWaypoints: waypoints.length,
        completedWaypoints: waypoints.length,
        currentTarget: finalTarget,
        estimatedDistanceMeters: geom.distanceMeters,
        estimatedHeadingRadians: params.odometry.pose.headingRadians,
        desiredHeadingRadians: geom.desiredHeadingRadians,
        headingErrorRadians: geom.headingErrorRadians,
        targetLinearVelocityMps: 0,
        targetAngularVelocityRadPerSec: 0,
        acceptanceRadiusMeters: config.acceptanceRadiusMeters,
        elapsedSeconds: 0,
        stepCount: 0,
        warnings: [],
      };
      return this.state;
    }

    this.activeConfig = config;
    const ok = this.startVelocityHoldLoop({
      motionController: params.motionController,
      config,
      model: params.model,
      odometry: params.odometry,
      binding: params.binding,
    });
    if (!ok) {
      return this.state;
    }

    const cmd = this.computeGuidanceCommand({
      config,
      odometry: params.odometry,
      waypointIndex: index,
      waypoints,
    });
    params.motionController.updateVelocityHoldTargets({
      linearVelocityMps: cmd.targetLinearVelocityMps,
      angularVelocityRadPerSec: cmd.targetAngularVelocityRadPerSec,
    });

    this.state = {
      status: "navigating",
      isActive: true,
      waypoints,
      currentWaypointIndex: index,
      totalWaypoints: waypoints.length,
      completedWaypoints: index,
      currentTarget: waypoints[index]!,
      estimatedDistanceMeters: cmd.distanceMeters,
      estimatedHeadingRadians: params.odometry.pose.headingRadians,
      desiredHeadingRadians: cmd.desiredHeadingRadians,
      headingErrorRadians: cmd.headingErrorRadians,
      targetLinearVelocityMps: cmd.targetLinearVelocityMps,
      targetAngularVelocityRadPerSec: cmd.targetAngularVelocityRadPerSec,
      acceptanceRadiusMeters: config.acceptanceRadiusMeters,
      elapsedSeconds: 0,
      stepCount: 0,
      warnings: index > 0
        ? [`Skipped ${index} initial waypoint(s) already inside acceptance radius.`]
        : [],
    };
    return this.state;
  }

  pause(motionController?: ClosedLoopMotionController): WaypointNavigationState {
    if (this.state.status !== "navigating") {
      return this.state;
    }
    motionController?.cancel("Navigation paused.");
    this.state = {
      ...this.state,
      status: "paused",
      isActive: false,
      targetLinearVelocityMps: 0,
      targetAngularVelocityRadPerSec: 0,
      warnings: [...this.state.warnings, "Navigation paused."],
    };
    return this.state;
  }

  resume(params: {
    readonly model: DifferentialDriveModel;
    readonly odometry: DifferentialDriveOdometryState;
    readonly binding: MotorHardwareBinding;
    readonly motionController: ClosedLoopMotionController;
  }): WaypointNavigationState {
    if (this.state.status !== "paused" || !this.activeConfig) {
      return this.state;
    }

    const prereqErr = this.validatePrerequisites({
      model: params.model,
      odometry: params.odometry,
      binding: params.binding,
      config: this.activeConfig,
    });
    if (prereqErr) {
      return this.failNavigation(prereqErr, params.motionController);
    }

    const ok = this.startVelocityHoldLoop({
      motionController: params.motionController,
      config: this.activeConfig,
      model: params.model,
      odometry: params.odometry,
      binding: params.binding,
    });
    if (!ok) {
      return this.state;
    }

    const cmd = this.computeGuidanceCommand({
      config: this.activeConfig,
      odometry: params.odometry,
      waypointIndex: Math.max(0, this.state.currentWaypointIndex),
      waypoints: this.state.waypoints,
    });
    params.motionController.updateVelocityHoldTargets({
      linearVelocityMps: cmd.targetLinearVelocityMps,
      angularVelocityRadPerSec: cmd.targetAngularVelocityRadPerSec,
    });

    this.state = {
      ...this.state,
      status: "navigating",
      isActive: true,
      estimatedDistanceMeters: cmd.distanceMeters,
      estimatedHeadingRadians: params.odometry.pose.headingRadians,
      desiredHeadingRadians: cmd.desiredHeadingRadians,
      headingErrorRadians: cmd.headingErrorRadians,
      targetLinearVelocityMps: cmd.targetLinearVelocityMps,
      targetAngularVelocityRadPerSec: cmd.targetAngularVelocityRadPerSec,
      warnings: [...this.state.warnings, "Navigation resumed."],
    };
    return this.state;
  }

  cancel(
    reason = "Navigation cancelled.",
    motionController?: ClosedLoopMotionController
  ): WaypointNavigationState {
    if (
      this.state.status !== "navigating" &&
      this.state.status !== "paused"
    ) {
      return this.state;
    }
    motionController?.cancel(reason);
    this.activeConfig = null;
    this.state = {
      ...this.state,
      status: "cancelled",
      isActive: false,
      targetLinearVelocityMps: 0,
      targetAngularVelocityRadPerSec: 0,
      warnings: [...this.state.warnings, reason],
    };
    return this.state;
  }

  reset(motionController?: ClosedLoopMotionController): WaypointNavigationState {
    motionController?.reset();
    this.activeConfig = null;
    this.state = this.createIdleState();
    return this.state;
  }

  fail(
    reason: string,
    motionController?: ClosedLoopMotionController
  ): WaypointNavigationState {
    return this.failNavigation(reason, motionController);
  }

  step(params: {
    readonly dtSeconds: number;
    readonly odometry: DifferentialDriveOdometryState;
    readonly model: DifferentialDriveModel;
    readonly binding: MotorHardwareBinding;
    readonly motionController: ClosedLoopMotionController;
    readonly linearSpeedScale?: number;
    readonly velocityOverride?: {
      readonly linearVelocityMps: number;
      readonly angularVelocityRadPerSec: number;
    } | null;
  }): WaypointNavigationState {
    if (
      this.state.status !== "navigating" ||
      !this.state.isActive ||
      !this.activeConfig
    ) {
      return this.state;
    }

    const { dtSeconds, odometry, model, binding, motionController } = params;
    const speedScale =
      params.linearSpeedScale !== undefined &&
      Number.isFinite(params.linearSpeedScale)
        ? Math.max(0, Math.min(1, params.linearSpeedScale))
        : 1;
    const override = params.velocityOverride ?? null;
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return this.state;
    }

    const prereqErr = this.validatePrerequisites({
      model,
      odometry,
      binding,
      config: this.activeConfig,
    });
    if (prereqErr) {
      return this.failNavigation(prereqErr, motionController);
    }

    const motionState = motionController.getState();
    if (!motionState.isActive || motionState.status === "failed") {
      return this.failNavigation(
        motionState.failureReason ??
          "Closed-loop motion controller interrupted during waypoint navigation.",
        motionController
      );
    }

    const elapsedSeconds = this.state.elapsedSeconds + dtSeconds;
    const stepCount = this.state.stepCount + 1;

    if (
      this.activeConfig.timeoutSeconds !== null &&
      elapsedSeconds >= this.activeConfig.timeoutSeconds
    ) {
      const timeoutMsg = `Waypoint navigation timed out after ${this.activeConfig.timeoutSeconds.toFixed(2)}s at waypoint ${this.state.currentWaypointIndex + 1}/${this.state.totalWaypoints}.`;
      return this.failNavigation(timeoutMsg, motionController);
    }

    const waypoints = this.state.waypoints;
    let index = this.state.currentWaypointIndex;
    let geom = computeTargetGeometry(odometry, waypoints[index]!);

    // Advance past any reached waypoint(s) without oscillating at boundary
    while (geom.distanceMeters <= this.activeConfig.acceptanceRadiusMeters) {
      index += 1;
      if (index >= waypoints.length) {
        motionController.cancel("Waypoint navigation completed.");
        this.activeConfig = null;
        const finalTarget = waypoints[waypoints.length - 1]!;
        const finalGeom = computeTargetGeometry(odometry, finalTarget);
        this.state = {
          ...this.state,
          status: "completed",
          isActive: false,
          currentWaypointIndex: waypoints.length - 1,
          completedWaypoints: waypoints.length,
          currentTarget: finalTarget,
          estimatedDistanceMeters: finalGeom.distanceMeters,
          estimatedHeadingRadians: odometry.pose.headingRadians,
          desiredHeadingRadians: finalGeom.desiredHeadingRadians,
          headingErrorRadians: finalGeom.headingErrorRadians,
          targetLinearVelocityMps: 0,
          targetAngularVelocityRadPerSec: 0,
          elapsedSeconds,
          stepCount,
        };
        return this.state;
      }
      geom = computeTargetGeometry(odometry, waypoints[index]!);
    }

    const cmd = this.computeGuidanceCommand({
      config: this.activeConfig,
      odometry,
      waypointIndex: index,
      waypoints,
    });

    const effectiveLinearVel = override
      ? override.linearVelocityMps
      : cmd.targetLinearVelocityMps * speedScale;
    const effectiveAngularVel = override
      ? override.angularVelocityRadPerSec
      : cmd.targetAngularVelocityRadPerSec;

    const updatedMotion = motionController.updateVelocityHoldTargets({
      linearVelocityMps: effectiveLinearVel,
      angularVelocityRadPerSec: effectiveAngularVel,
    });
    if (!updatedMotion.isActive) {
      return this.failNavigation(
        updatedMotion.failureReason ??
          "Closed-loop motion target update failed during navigation.",
        motionController
      );
    }

    this.state = {
      ...this.state,
      status: "navigating",
      isActive: true,
      currentWaypointIndex: index,
      completedWaypoints: index,
      currentTarget: waypoints[index]!,
      estimatedDistanceMeters: cmd.distanceMeters,
      estimatedHeadingRadians: odometry.pose.headingRadians,
      desiredHeadingRadians: cmd.desiredHeadingRadians,
      headingErrorRadians: cmd.headingErrorRadians,
      targetLinearVelocityMps: effectiveLinearVel,
      targetAngularVelocityRadPerSec: effectiveAngularVel,
      elapsedSeconds,
      stepCount,
    };
    return this.state;
  }
}
