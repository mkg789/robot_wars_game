import type {
  AvoidanceDirection,
  DifferentialDriveOdometryState,
  DistanceSensorObservation,
  ObstacleAvoidanceOptions,
  ObstacleAvoidanceState,
} from "../types/control.types";
import type { SensorAvailabilityStatus } from "../types/sensor.types";
import { wrapNavigationAngleSigned } from "./waypointNavigationController";

const DEFAULT_DETECTION_DISTANCE_M = 1.6;
const DEFAULT_SLOWDOWN_DISTANCE_M = 0.95;
const DEFAULT_SAFETY_DISTANCE_M = 0.45;
const DEFAULT_CLEAR_HYSTERESIS_M = 0.12;
const DEFAULT_MIN_SLOWDOWN_SCALE = 0.25;
const DEFAULT_AVOID_TURN_SPEED_RAD_PER_SEC = 2.2;
const DEFAULT_AVOID_ADVANCE_SPEED_MPS = 0.45;
const DEFAULT_MIN_AVOID_TURN_RAD = 0.65;
const DEFAULT_MAX_AVOID_TURN_RAD = Math.PI * 0.85;
const DEFAULT_AVOID_ADVANCE_DISTANCE_M = 0.6;
const DEFAULT_STOP_CONFIRM_SECONDS = 0.15;
const DEFAULT_VERIFY_CLEAR_SECONDS = 0.15;
const DEFAULT_COOLDOWN_SECONDS = 0.45;
const DEFAULT_MAX_AVOIDANCE_ATTEMPTS = 3;
const DEFAULT_MAX_MANEUVER_SECONDS = 12.0;
const DEFAULT_DIRECTION_HYSTERESIS_M = 0.08;
const SUSTAINED_CLEAR_RESET_SECONDS = 1.5;

const FORWARD_PRIMARY_YAW_RAD = 0.45;
const FORWARD_WIDE_YAW_RAD = 0.85;

interface ResolvedAvoidanceConfig {
  readonly enabled: boolean;
  readonly requireValidSensor: boolean;
  readonly detectionDistanceMeters: number;
  readonly slowdownDistanceMeters: number;
  readonly safetyDistanceMeters: number;
  readonly clearHysteresisMeters: number;
  readonly minSlowdownSpeedScale: number;
  readonly avoidTurnSpeedRadPerSec: number;
  readonly avoidAdvanceSpeedMps: number;
  readonly minAvoidTurnRadians: number;
  readonly maxAvoidTurnRadians: number;
  readonly avoidAdvanceDistanceMeters: number;
  readonly stopConfirmSeconds: number;
  readonly verifyClearSeconds: number;
  readonly cooldownSeconds: number;
  readonly maxAvoidanceAttempts: number;
  readonly maxManeuverSeconds: number;
  readonly defaultDirection: AvoidanceDirection;
  readonly directionHysteresisMeters: number;
  readonly errors: readonly string[];
}

function resolveAvoidanceConfig(
  options: ObstacleAvoidanceOptions | undefined,
  enabled: boolean
): ResolvedAvoidanceConfig {
  const errors: string[] = [];

  const detectionDistanceMeters =
    options?.detectionDistanceMeters ?? DEFAULT_DETECTION_DISTANCE_M;
  const slowdownDistanceMeters =
    options?.slowdownDistanceMeters ?? DEFAULT_SLOWDOWN_DISTANCE_M;
  const safetyDistanceMeters =
    options?.safetyDistanceMeters ?? DEFAULT_SAFETY_DISTANCE_M;
  const clearHysteresisMeters =
    options?.clearHysteresisMeters ?? DEFAULT_CLEAR_HYSTERESIS_M;
  const minSlowdownSpeedScale =
    options?.minSlowdownSpeedScale ?? DEFAULT_MIN_SLOWDOWN_SCALE;
  const avoidTurnSpeedRadPerSec =
    options?.avoidTurnSpeedRadPerSec ?? DEFAULT_AVOID_TURN_SPEED_RAD_PER_SEC;
  const avoidAdvanceSpeedMps =
    options?.avoidAdvanceSpeedMps ?? DEFAULT_AVOID_ADVANCE_SPEED_MPS;
  const minAvoidTurnRadians =
    options?.minAvoidTurnRadians ?? DEFAULT_MIN_AVOID_TURN_RAD;
  const maxAvoidTurnRadians =
    options?.maxAvoidTurnRadians ?? DEFAULT_MAX_AVOID_TURN_RAD;
  const avoidAdvanceDistanceMeters =
    options?.avoidAdvanceDistanceMeters ?? DEFAULT_AVOID_ADVANCE_DISTANCE_M;
  const stopConfirmSeconds =
    options?.stopConfirmSeconds ?? DEFAULT_STOP_CONFIRM_SECONDS;
  const verifyClearSeconds =
    options?.verifyClearSeconds ?? DEFAULT_VERIFY_CLEAR_SECONDS;
  const cooldownSeconds = options?.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
  const maxAvoidanceAttempts =
    options?.maxAvoidanceAttempts ?? DEFAULT_MAX_AVOIDANCE_ATTEMPTS;
  const maxManeuverSeconds =
    options?.maxManeuverSeconds ?? DEFAULT_MAX_MANEUVER_SECONDS;
  const defaultDirection = options?.defaultDirection ?? "left";
  const directionHysteresisMeters =
    options?.directionHysteresisMeters ?? DEFAULT_DIRECTION_HYSTERESIS_M;
  const requireValidSensor = options?.requireValidSensor ?? enabled;

  if (!Number.isFinite(safetyDistanceMeters) || safetyDistanceMeters <= 0) {
    errors.push("safetyDistanceMeters must be positive and finite.");
  }
  if (
    !Number.isFinite(slowdownDistanceMeters) ||
    slowdownDistanceMeters <= safetyDistanceMeters
  ) {
    errors.push(
      "slowdownDistanceMeters must be finite and greater than safetyDistanceMeters."
    );
  }
  if (
    !Number.isFinite(detectionDistanceMeters) ||
    detectionDistanceMeters < slowdownDistanceMeters
  ) {
    errors.push(
      "detectionDistanceMeters must be finite and >= slowdownDistanceMeters."
    );
  }
  if (!Number.isFinite(clearHysteresisMeters) || clearHysteresisMeters < 0) {
    errors.push("clearHysteresisMeters must be non-negative and finite.");
  }
  if (
    !Number.isFinite(minSlowdownSpeedScale) ||
    minSlowdownSpeedScale < 0 ||
    minSlowdownSpeedScale > 1
  ) {
    errors.push("minSlowdownSpeedScale must be finite within [0, 1].");
  }
  if (!Number.isFinite(avoidTurnSpeedRadPerSec) || avoidTurnSpeedRadPerSec <= 0) {
    errors.push("avoidTurnSpeedRadPerSec must be positive and finite.");
  }
  if (!Number.isFinite(avoidAdvanceSpeedMps) || avoidAdvanceSpeedMps <= 0) {
    errors.push("avoidAdvanceSpeedMps must be positive and finite.");
  }
  if (
    !Number.isFinite(minAvoidTurnRadians) ||
    minAvoidTurnRadians <= 0 ||
    !Number.isFinite(maxAvoidTurnRadians) ||
    maxAvoidTurnRadians < minAvoidTurnRadians
  ) {
    errors.push(
      "Avoidance turn angle bounds must satisfy 0 < minAvoidTurnRadians <= maxAvoidTurnRadians."
    );
  }
  if (
    !Number.isFinite(avoidAdvanceDistanceMeters) ||
    avoidAdvanceDistanceMeters <= 0
  ) {
    errors.push("avoidAdvanceDistanceMeters must be positive and finite.");
  }
  if (
    !Number.isFinite(stopConfirmSeconds) ||
    stopConfirmSeconds < 0 ||
    !Number.isFinite(verifyClearSeconds) ||
    verifyClearSeconds < 0 ||
    !Number.isFinite(cooldownSeconds) ||
    cooldownSeconds < 0
  ) {
    errors.push("Avoidance timing options must be non-negative and finite.");
  }
  if (!Number.isInteger(maxAvoidanceAttempts) || maxAvoidanceAttempts <= 0) {
    errors.push("maxAvoidanceAttempts must be a positive integer.");
  }
  if (!Number.isFinite(maxManeuverSeconds) || maxManeuverSeconds <= 0) {
    errors.push("maxManeuverSeconds must be positive and finite.");
  }

  return {
    enabled,
    requireValidSensor,
    detectionDistanceMeters,
    slowdownDistanceMeters,
    safetyDistanceMeters,
    clearHysteresisMeters,
    minSlowdownSpeedScale,
    avoidTurnSpeedRadPerSec,
    avoidAdvanceSpeedMps,
    minAvoidTurnRadians,
    maxAvoidTurnRadians,
    avoidAdvanceDistanceMeters,
    stopConfirmSeconds,
    verifyClearSeconds,
    cooldownSeconds,
    maxAvoidanceAttempts,
    maxManeuverSeconds,
    defaultDirection,
    directionHysteresisMeters,
    errors,
  };
}

interface AnalyzedDistanceSensors {
  readonly sensorStatus: SensorAvailabilityStatus;
  readonly sensorErrorReason: string | null;
  readonly forwardObstacleDistanceMeters: number | null;
  readonly nearestObstacleDistanceMeters: number | null;
  readonly detectedSensorId: string | null;
  readonly leftClearanceMeters: number | null;
  readonly rightClearanceMeters: number | null;
  readonly warnings: readonly string[];
}

function analyzeDistanceSensors(
  observations: readonly DistanceSensorObservation[]
): AnalyzedDistanceSensors {
  if (observations.length === 0) {
    return {
      sensorStatus: "not-installed",
      sensorErrorReason:
        "No ultrasonic or ToF distance sensors are installed for obstacle detection.",
      forwardObstacleDistanceMeters: null,
      nearestObstacleDistanceMeters: null,
      detectedSensorId: null,
      leftClearanceMeters: null,
      rightClearanceMeters: null,
      warnings: [],
    };
  }

  const primaryForward = observations.filter(
    (obs) => Math.abs(obs.mountYawOffsetRadians) <= FORWARD_PRIMARY_YAW_RAD
  );
  const forwardCandidates =
    primaryForward.length > 0
      ? primaryForward
      : observations.filter(
          (obs) => Math.abs(obs.mountYawOffsetRadians) <= FORWARD_WIDE_YAW_RAD
        );

  if (forwardCandidates.length === 0) {
    return {
      sensorStatus: "not-installed",
      sensorErrorReason:
        "Installed distance sensors are not oriented within the forward detection sector.",
      forwardObstacleDistanceMeters: null,
      nearestObstacleDistanceMeters: null,
      detectedSensorId: null,
      leftClearanceMeters: null,
      rightClearanceMeters: null,
      warnings: [],
    };
  }

  const readyForward = forwardCandidates.filter(
    (obs) => obs.reading.ok && obs.reading.data !== null
  );
  const warnings: string[] = [];

  if (readyForward.length === 0) {
    const faulted = forwardCandidates.find(
      (obs) => obs.reading.status === "unavailable-electrical-fault"
    );
    const firstBlocked = faulted ?? forwardCandidates[0]!;
    return {
      sensorStatus: firstBlocked.reading.status,
      sensorErrorReason:
        firstBlocked.reading.reason ??
        `Forward distance sensor "${firstBlocked.sensorName}" is unavailable (${firstBlocked.reading.status}).`,
      forwardObstacleDistanceMeters: null,
      nearestObstacleDistanceMeters: null,
      detectedSensorId: firstBlocked.sensorId,
      leftClearanceMeters: null,
      rightClearanceMeters: null,
      warnings: [],
    };
  }

  if (readyForward.length < forwardCandidates.length) {
    const failedCount = forwardCandidates.length - readyForward.length;
    warnings.push(
      `${failedCount} forward distance sensor(s) unavailable; relying on remaining active sensor(s).`
    );
  }

  let forwardDist: number | null = null;
  let detectedSensorId: string | null = null;
  for (const obs of readyForward) {
    const data = obs.reading.data!;
    if (!Number.isFinite(data.distanceMeters)) continue;
    if (data.inRange && (forwardDist === null || data.distanceMeters < forwardDist)) {
      forwardDist = data.distanceMeters;
      detectedSensorId = obs.sensorId;
    }
  }

  let nearestDist: number | null = null;
  let leftClearance: number | null = null;
  let rightClearance: number | null = null;

  for (const obs of observations) {
    if (!obs.reading.ok || !obs.reading.data) continue;
    const data = obs.reading.data;
    if (!Number.isFinite(data.distanceMeters)) continue;

    if (data.inRange && (nearestDist === null || data.distanceMeters < nearestDist)) {
      nearestDist = data.distanceMeters;
    }

    const effectiveClearance = data.inRange ? data.distanceMeters : data.maxRangeMeters;
    const yaw = obs.mountYawOffsetRadians;
    const zOffset = obs.localMountOffset.z;

    const isLeftSensor = yaw > 0.15 || (yaw >= -0.05 && zOffset > 0.04);
    const isRightSensor = yaw < -0.15 || (yaw <= 0.05 && zOffset < -0.04);

    if (isLeftSensor) {
      leftClearance =
        leftClearance === null
          ? effectiveClearance
          : Math.min(leftClearance, effectiveClearance);
    }
    if (isRightSensor) {
      rightClearance =
        rightClearance === null
          ? effectiveClearance
          : Math.min(rightClearance, effectiveClearance);
    }
  }

  return {
    sensorStatus: "ready",
    sensorErrorReason: null,
    forwardObstacleDistanceMeters: forwardDist,
    nearestObstacleDistanceMeters: nearestDist,
    detectedSensorId,
    leftClearanceMeters: leftClearance,
    rightClearanceMeters: rightClearance,
    warnings,
  };
}

export interface ObstacleAvoidanceStepResult {
  readonly state: ObstacleAvoidanceState;
  readonly linearSpeedScale: number;
  readonly velocityOverride: {
    readonly linearVelocityMps: number;
    readonly angularVelocityRadPerSec: number;
  } | null;
}

/**
 * Pure deterministic sensor-driven reactive obstacle avoidance controller executing
 * bounded stop -> turn -> advance -> verify-clear maneuvers alongside waypoint navigation.
 * Relies strictly on simulated distance sensor observations and encoder odometry.
 */
export class ReactiveObstacleAvoidanceController {
  private configuredOptions: ObstacleAvoidanceOptions | undefined = undefined;
  private activeConfig: ResolvedAvoidanceConfig | null = null;
  private phaseTimerSeconds = 0;
  private turnAccumulatedRadians = 0;
  private lastWrappedHeadingRad = 0;
  private advanceStartDistanceM = 0;
  private sustainedClearSeconds = 0;
  private lastChosenDirection: AvoidanceDirection | null = null;
  private lastFailedAttemptDirection: AvoidanceDirection | null = null;
  private state: ObstacleAvoidanceState = this.createIdleState(false);

  private createIdleState(enabled: boolean): ObstacleAvoidanceState {
    return {
      enabled,
      status: "idle",
      maneuverPhase: "none",
      isActive: false,
      chosenDirection: null,
      nearestObstacleDistanceMeters: null,
      forwardObstacleDistanceMeters: null,
      leftClearanceMeters: null,
      rightClearanceMeters: null,
      detectedSensorId: null,
      sensorStatus: "not-installed",
      activeSpeedScale: 1,
      commandedLinearVelocityMps: 0,
      commandedAngularVelocityRadPerSec: 0,
      maneuverTurnProgressRadians: 0,
      maneuverAdvanceProgressMeters: 0,
      attemptCount: 0,
      cooldownRemainingSeconds: 0,
      maneuverElapsedSeconds: 0,
      stepCount: 0,
      warnings: [],
    };
  }

  getState(): ObstacleAvoidanceState {
    return this.state;
  }

  getConfiguredOptions(): ObstacleAvoidanceOptions | undefined {
    return this.configuredOptions;
  }

  configure(options?: ObstacleAvoidanceOptions): ObstacleAvoidanceState {
    this.configuredOptions = options;
    const enabled = options?.enabled ?? true;
    const resolved = resolveAvoidanceConfig(options, enabled);
    if (resolved.errors.length > 0) {
      this.activeConfig = null;
      this.state = {
        ...this.createIdleState(false),
        status: "blocked",
        failureReason: resolved.errors.join(" "),
        warnings: resolved.errors,
      };
      return this.state;
    }
    this.activeConfig = resolved;
    this.state = {
      ...this.state,
      enabled,
      warnings: [],
      failureReason: undefined,
    };
    return this.state;
  }

  /**
   * Initializes avoidance session for a waypoint navigation run. Auto-enables whenever
   * distance sensors are installed unless explicitly disabled, or whenever enabled explicitly.
   */
  beginNavigationSession(params: {
    readonly observations: readonly DistanceSensorObservation[];
    readonly navigationOptions?: ObstacleAvoidanceOptions;
  }): ObstacleAvoidanceState {
    const mergedOptions: ObstacleAvoidanceOptions | undefined =
      params.navigationOptions || this.configuredOptions
        ? {
            ...this.configuredOptions,
            ...params.navigationOptions,
          }
        : undefined;

    const explicitEnabled = mergedOptions?.enabled;
    const hasInstalledDistanceSensors = params.observations.length > 0;
    const enabled =
      explicitEnabled !== undefined ? explicitEnabled : hasInstalledDistanceSensors;

    this.phaseTimerSeconds = 0;
    this.turnAccumulatedRadians = 0;
    this.lastWrappedHeadingRad = 0;
    this.advanceStartDistanceM = 0;
    this.sustainedClearSeconds = 0;
    this.lastChosenDirection = null;
    this.lastFailedAttemptDirection = null;

    if (!enabled) {
      this.activeConfig = null;
      this.state = this.createIdleState(false);
      return this.state;
    }

    const config = resolveAvoidanceConfig(mergedOptions, true);
    if (config.errors.length > 0) {
      this.activeConfig = null;
      this.state = {
        ...this.createIdleState(true),
        status: "blocked",
        failureReason: config.errors.join(" "),
        warnings: config.errors,
      };
      return this.state;
    }

    this.activeConfig = config;
    const analysis = analyzeDistanceSensors(params.observations);
    if (config.requireValidSensor && analysis.sensorStatus !== "ready") {
      const reason =
        analysis.sensorErrorReason ??
        "Required distance sensor is unavailable for obstacle avoidance.";
      this.state = {
        ...this.createIdleState(true),
        status: "blocked",
        sensorStatus: analysis.sensorStatus,
        detectedSensorId: analysis.detectedSensorId,
        activeSpeedScale: 0,
        failureReason: reason,
        warnings: [reason],
      };
      return this.state;
    }

    this.state = {
      ...this.createIdleState(true),
      status: "clear",
      isActive: true,
      sensorStatus: analysis.sensorStatus,
      forwardObstacleDistanceMeters: analysis.forwardObstacleDistanceMeters,
      nearestObstacleDistanceMeters: analysis.nearestObstacleDistanceMeters,
      leftClearanceMeters: analysis.leftClearanceMeters,
      rightClearanceMeters: analysis.rightClearanceMeters,
      detectedSensorId: analysis.detectedSensorId,
      warnings: analysis.warnings,
    };
    return this.state;
  }

  pause(): ObstacleAvoidanceState {
    if (!this.state.enabled || !this.state.isActive) {
      return this.state;
    }
    this.state = {
      ...this.state,
      commandedLinearVelocityMps: 0,
      commandedAngularVelocityRadPerSec: 0,
    };
    return this.state;
  }

  cancel(reason = "Obstacle avoidance cancelled."): ObstacleAvoidanceState {
    if (!this.state.enabled || this.state.status === "idle") {
      return this.state;
    }
    this.state = {
      ...this.state,
      status: "cancelled",
      maneuverPhase: "none",
      isActive: false,
      activeSpeedScale: 0,
      commandedLinearVelocityMps: 0,
      commandedAngularVelocityRadPerSec: 0,
      warnings: [...this.state.warnings, reason],
    };
    return this.state;
  }

  completeNavigation(): ObstacleAvoidanceState {
    if (!this.state.enabled || !this.state.isActive) {
      return this.state;
    }
    this.state = {
      ...this.state,
      maneuverPhase: "none",
      isActive: false,
      activeSpeedScale: 1,
      commandedLinearVelocityMps: 0,
      commandedAngularVelocityRadPerSec: 0,
      cooldownRemainingSeconds: 0,
    };
    return this.state;
  }

  reset(): ObstacleAvoidanceState {
    this.activeConfig = null;
    this.phaseTimerSeconds = 0;
    this.turnAccumulatedRadians = 0;
    this.lastWrappedHeadingRad = 0;
    this.advanceStartDistanceM = 0;
    this.sustainedClearSeconds = 0;
    this.lastChosenDirection = null;
    this.lastFailedAttemptDirection = null;
    this.state = this.createIdleState(false);
    return this.state;
  }

  private chooseAvoidanceDirection(params: {
    readonly config: ResolvedAvoidanceConfig;
    readonly analysis: AnalyzedDistanceSensors;
    readonly headingErrorRadians: number;
    readonly attemptCount: number;
  }): AvoidanceDirection {
    const { config, analysis, headingErrorRadians, attemptCount } = params;
    const clearThreshold =
      config.safetyDistanceMeters + config.clearHysteresisMeters * 1.5;

    if (attemptCount > 1 && this.lastFailedAttemptDirection) {
      return this.lastFailedAttemptDirection === "left" ? "right" : "left";
    }

    const left = analysis.leftClearanceMeters;
    const right = analysis.rightClearanceMeters;
    if (left !== null && right !== null) {
      if (Math.abs(left - right) >= config.directionHysteresisMeters) {
        return left > right ? "left" : "right";
      }
    } else if (left !== null) {
      if (left <= clearThreshold) return "right";
      if (left > config.slowdownDistanceMeters) return "left";
    } else if (right !== null) {
      if (right <= clearThreshold) return "left";
      if (right > config.slowdownDistanceMeters) return "right";
    }

    if (this.state.cooldownRemainingSeconds > 0 && this.lastChosenDirection) {
      return this.lastChosenDirection;
    }

    if (Math.abs(headingErrorRadians) > 0.2) {
      return headingErrorRadians > 0 ? "left" : "right";
    }

    return config.defaultDirection;
  }

  private computeSlowdownScale(
    distanceMeters: number,
    config: ResolvedAvoidanceConfig
  ): number {
    const span = config.slowdownDistanceMeters - config.safetyDistanceMeters;
    if (span <= 1e-6) return config.minSlowdownSpeedScale;
    const ratio = Math.max(
      0,
      Math.min(1, (distanceMeters - config.safetyDistanceMeters) / span)
    );
    return (
      config.minSlowdownSpeedScale +
      ratio * (1 - config.minSlowdownSpeedScale)
    );
  }

  private enterBlockedState(params: {
    readonly reason: string;
    readonly analysis: AnalyzedDistanceSensors;
    readonly stepCount: number;
    readonly attemptCount: number;
    readonly maneuverElapsedSeconds: number;
  }): ObstacleAvoidanceStepResult {
    this.state = {
      ...this.state,
      status: "blocked",
      maneuverPhase: "none",
      isActive: false,
      sensorStatus: params.analysis.sensorStatus,
      forwardObstacleDistanceMeters: params.analysis.forwardObstacleDistanceMeters,
      nearestObstacleDistanceMeters: params.analysis.nearestObstacleDistanceMeters,
      leftClearanceMeters: params.analysis.leftClearanceMeters,
      rightClearanceMeters: params.analysis.rightClearanceMeters,
      detectedSensorId: params.analysis.detectedSensorId,
      activeSpeedScale: 0,
      commandedLinearVelocityMps: 0,
      commandedAngularVelocityRadPerSec: 0,
      attemptCount: params.attemptCount,
      maneuverElapsedSeconds: params.maneuverElapsedSeconds,
      stepCount: params.stepCount,
      failureReason: params.reason,
      warnings: Array.from(new Set([...this.state.warnings, params.reason])),
    };
    return {
      state: this.state,
      linearSpeedScale: 0,
      velocityOverride: {
        linearVelocityMps: 0,
        angularVelocityRadPerSec: 0,
      },
    };
  }

  step(params: {
    readonly dtSeconds: number;
    readonly observations: readonly DistanceSensorObservation[];
    readonly odometry: DifferentialDriveOdometryState;
    readonly headingErrorRadians?: number;
  }): ObstacleAvoidanceStepResult {
    if (!this.state.enabled || !this.activeConfig || !this.state.isActive) {
      return {
        state: this.state,
        linearSpeedScale: this.state.status === "blocked" ? 0 : 1,
        velocityOverride:
          this.state.status === "blocked"
            ? { linearVelocityMps: 0, angularVelocityRadPerSec: 0 }
            : null,
      };
    }

    const { dtSeconds, observations, odometry } = params;
    const headingErrorRadians = params.headingErrorRadians ?? 0;
    const config = this.activeConfig;

    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return {
        state: this.state,
        linearSpeedScale: this.state.activeSpeedScale,
        velocityOverride: null,
      };
    }

    const stepCount = this.state.stepCount + 1;
    const analysis = analyzeDistanceSensors(observations);

    if (config.requireValidSensor && analysis.sensorStatus !== "ready") {
      return this.enterBlockedState({
        reason:
          analysis.sensorErrorReason ??
          "Distance sensor unavailable during obstacle avoidance.",
        analysis,
        stepCount,
        attemptCount: this.state.attemptCount,
        maneuverElapsedSeconds: this.state.maneuverElapsedSeconds,
      });
    }

    if (!odometry.isValid || odometry.status !== "ready") {
      return this.enterBlockedState({
        reason:
          odometry.error ??
          `Encoder odometry unavailable (${odometry.status}) during obstacle avoidance.`,
        analysis,
        stepCount,
        attemptCount: this.state.attemptCount,
        maneuverElapsedSeconds: this.state.maneuverElapsedSeconds,
      });
    }

    const forwardDist = analysis.forwardObstacleDistanceMeters;
    const withinDetection =
      forwardDist !== null && forwardDist <= config.detectionDistanceMeters;
    const measuredForward = withinDetection ? forwardDist : null;

    const enterStop = config.safetyDistanceMeters;
    const exitStop = config.safetyDistanceMeters + config.clearHysteresisMeters;
    const enterSlow = config.slowdownDistanceMeters;
    const exitSlow = Math.min(
      config.detectionDistanceMeters,
      config.slowdownDistanceMeters + config.clearHysteresisMeters
    );
    const clearThreshold =
      config.safetyDistanceMeters + config.clearHysteresisMeters * 1.5;

    let status = this.state.status;
    let maneuverPhase = this.state.maneuverPhase;
    let chosenDirection = this.state.chosenDirection;
    let attemptCount = this.state.attemptCount;
    let cooldownRemaining = Math.max(
      0,
      this.state.cooldownRemainingSeconds - dtSeconds
    );
    let maneuverElapsed = this.state.maneuverElapsedSeconds;
    let speedScale = 1.0;
    let velocityOverride: {
      readonly linearVelocityMps: number;
      readonly angularVelocityRadPerSec: number;
    } | null = null;
    let advanceProgress = this.state.maneuverAdvanceProgressMeters;

    if (status === "clear" || status === "slowing") {
      if (measuredForward !== null && measuredForward <= enterStop) {
        status = "stopped";
        maneuverPhase = "stop-confirm";
        this.phaseTimerSeconds = 0;
        maneuverElapsed = 0;
        this.sustainedClearSeconds = 0;
        speedScale = 0;
        velocityOverride = { linearVelocityMps: 0, angularVelocityRadPerSec: 0 };
      } else if (
        measuredForward !== null &&
        (measuredForward <= enterSlow ||
          (status === "slowing" && measuredForward <= exitSlow))
      ) {
        status = "slowing";
        maneuverPhase = "none";
        this.sustainedClearSeconds = 0;
        speedScale = this.computeSlowdownScale(measuredForward, config);
      } else {
        status = "clear";
        maneuverPhase = "none";
        speedScale = 1.0;
        this.sustainedClearSeconds += dtSeconds;
        if (this.sustainedClearSeconds >= SUSTAINED_CLEAR_RESET_SECONDS) {
          attemptCount = 0;
          this.lastFailedAttemptDirection = null;
        }
      }
    } else if (status === "stopped") {
      this.phaseTimerSeconds += dtSeconds;
      maneuverElapsed += dtSeconds;
      speedScale = 0;
      velocityOverride = { linearVelocityMps: 0, angularVelocityRadPerSec: 0 };

      if (this.phaseTimerSeconds >= config.stopConfirmSeconds) {
        if (measuredForward === null || measuredForward > exitStop) {
          // Obstacle cleared safely after confirmed stop delay
          this.phaseTimerSeconds = 0;
          maneuverElapsed = 0;
          maneuverPhase = "none";
          status =
            measuredForward !== null && measuredForward <= exitSlow
              ? "slowing"
              : "clear";
          speedScale =
            status === "slowing" && measuredForward !== null
              ? this.computeSlowdownScale(measuredForward, config)
              : 1.0;
          velocityOverride = null;
        } else {
          attemptCount += 1;
          if (attemptCount > config.maxAvoidanceAttempts) {
            return this.enterBlockedState({
              reason: `Obstacle remains within safety zone after ${config.maxAvoidanceAttempts} avoidance attempt(s).`,
              analysis,
              stepCount,
              attemptCount: config.maxAvoidanceAttempts,
              maneuverElapsedSeconds: maneuverElapsed,
            });
          }
          chosenDirection = this.chooseAvoidanceDirection({
            config,
            analysis,
            headingErrorRadians,
            attemptCount,
          });
          this.lastChosenDirection = chosenDirection;
          status = "avoiding";
          maneuverPhase = "turn";
          this.phaseTimerSeconds = 0;
          this.turnAccumulatedRadians = 0;
          this.lastWrappedHeadingRad = odometry.pose.headingRadians;
          advanceProgress = 0;
        }
      }
    } else if (status === "avoiding") {
      maneuverElapsed += dtSeconds;
      if (maneuverElapsed >= config.maxManeuverSeconds) {
        return this.enterBlockedState({
          reason: `Obstacle avoidance maneuver timed out after ${config.maxManeuverSeconds.toFixed(1)}s.`,
          analysis,
          stepCount,
          attemptCount,
          maneuverElapsedSeconds: maneuverElapsed,
        });
      }

      const dir = chosenDirection ?? config.defaultDirection;
      chosenDirection = dir;

      if (maneuverPhase === "turn") {
        const deltaH = Math.abs(
          wrapNavigationAngleSigned(
            odometry.pose.headingRadians - this.lastWrappedHeadingRad
          )
        );
        this.turnAccumulatedRadians += deltaH;
        this.lastWrappedHeadingRad = odometry.pose.headingRadians;

        const pathIsOpen =
          measuredForward === null || measuredForward > clearThreshold;

        if (
          this.turnAccumulatedRadians >= config.minAvoidTurnRadians &&
          pathIsOpen
        ) {
          maneuverPhase = "advance";
          this.advanceStartDistanceM = odometry.traveledDistanceMeters;
          advanceProgress = 0;
          speedScale = 0;
          velocityOverride = {
            linearVelocityMps: 0,
            angularVelocityRadPerSec: 0,
          };
        } else if (
          this.turnAccumulatedRadians >= config.maxAvoidTurnRadians &&
          !pathIsOpen
        ) {
          this.lastFailedAttemptDirection = dir;
          if (attemptCount >= config.maxAvoidanceAttempts) {
            return this.enterBlockedState({
              reason: `No clear avoidance heading found within ${((config.maxAvoidTurnRadians * 180) / Math.PI).toFixed(0)}° scan.`,
              analysis,
              stepCount,
              attemptCount,
              maneuverElapsedSeconds: maneuverElapsed,
            });
          }
          status = "stopped";
          maneuverPhase = "stop-confirm";
          this.phaseTimerSeconds = 0;
          speedScale = 0;
          velocityOverride = {
            linearVelocityMps: 0,
            angularVelocityRadPerSec: 0,
          };
        } else {
          const angularCmd =
            dir === "left"
              ? config.avoidTurnSpeedRadPerSec
              : -config.avoidTurnSpeedRadPerSec;
          speedScale = 0;
          velocityOverride = {
            linearVelocityMps: 0,
            angularVelocityRadPerSec: angularCmd,
          };
        }
      } else if (maneuverPhase === "advance") {
        advanceProgress = Math.max(
          0,
          odometry.traveledDistanceMeters - this.advanceStartDistanceM
        );
        if (measuredForward !== null && measuredForward <= enterStop) {
          this.lastFailedAttemptDirection = dir;
          if (attemptCount >= config.maxAvoidanceAttempts) {
            return this.enterBlockedState({
              reason: `Blocked during avoidance advance after ${attemptCount} attempt(s).`,
              analysis,
              stepCount,
              attemptCount,
              maneuverElapsedSeconds: maneuverElapsed,
            });
          }
          status = "stopped";
          maneuverPhase = "stop-confirm";
          this.phaseTimerSeconds = 0;
          speedScale = 0;
          velocityOverride = {
            linearVelocityMps: 0,
            angularVelocityRadPerSec: 0,
          };
        } else if (advanceProgress >= config.avoidAdvanceDistanceMeters) {
          maneuverPhase = "verify-clear";
          this.phaseTimerSeconds = 0;
          speedScale = 0;
          velocityOverride = {
            linearVelocityMps: 0,
            angularVelocityRadPerSec: 0,
          };
        } else {
          const advanceSpeed =
            measuredForward !== null && measuredForward <= enterSlow
              ? config.avoidAdvanceSpeedMps *
                this.computeSlowdownScale(measuredForward, config)
              : config.avoidAdvanceSpeedMps;
          speedScale = 0;
          velocityOverride = {
            linearVelocityMps: advanceSpeed,
            angularVelocityRadPerSec: 0,
          };
        }
      } else if (maneuverPhase === "verify-clear") {
        this.phaseTimerSeconds += dtSeconds;
        speedScale = 0;
        velocityOverride = {
          linearVelocityMps: 0,
          angularVelocityRadPerSec: 0,
        };

        if (measuredForward !== null && measuredForward <= enterStop) {
          this.lastFailedAttemptDirection = dir;
          if (attemptCount >= config.maxAvoidanceAttempts) {
            return this.enterBlockedState({
              reason: "Obstacle still within safety zone during clearance check.",
              analysis,
              stepCount,
              attemptCount,
              maneuverElapsedSeconds: maneuverElapsed,
            });
          }
          status = "stopped";
          maneuverPhase = "stop-confirm";
          this.phaseTimerSeconds = 0;
        } else if (this.phaseTimerSeconds >= config.verifyClearSeconds) {
          maneuverPhase = "none";
          this.phaseTimerSeconds = 0;
          cooldownRemaining = config.cooldownSeconds;
          this.sustainedClearSeconds = 0;
          status =
            measuredForward !== null && measuredForward <= exitSlow
              ? "slowing"
              : "clear";
          speedScale =
            status === "slowing" && measuredForward !== null
              ? this.computeSlowdownScale(measuredForward, config)
              : 1.0;
          velocityOverride = null;
        }
      }
    }

    this.state = {
      enabled: true,
      status,
      maneuverPhase,
      isActive: true,
      chosenDirection,
      nearestObstacleDistanceMeters: analysis.nearestObstacleDistanceMeters,
      forwardObstacleDistanceMeters: analysis.forwardObstacleDistanceMeters,
      leftClearanceMeters: analysis.leftClearanceMeters,
      rightClearanceMeters: analysis.rightClearanceMeters,
      detectedSensorId: analysis.detectedSensorId,
      sensorStatus: analysis.sensorStatus,
      activeSpeedScale: speedScale,
      commandedLinearVelocityMps: velocityOverride?.linearVelocityMps ?? 0,
      commandedAngularVelocityRadPerSec:
        velocityOverride?.angularVelocityRadPerSec ?? 0,
      maneuverTurnProgressRadians: this.turnAccumulatedRadians,
      maneuverAdvanceProgressMeters: advanceProgress,
      attemptCount,
      cooldownRemainingSeconds: cooldownRemaining,
      maneuverElapsedSeconds: maneuverElapsed,
      stepCount,
      warnings: analysis.warnings,
    };

    return {
      state: this.state,
      linearSpeedScale: speedScale,
      velocityOverride,
    };
  }
}
