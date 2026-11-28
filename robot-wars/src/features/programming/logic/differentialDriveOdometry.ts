import type {
  DifferentialDriveModel,
  DifferentialDriveOdometryState,
  OdometryEncoderChannelSnapshot,
  OdometryPose,
  OdometryStatus,
  OdometryStepDelta,
} from "../types/control.types";
import type {
  EncoderAccumulatorState,
  SensorDescriptor,
} from "../types/sensor.types";

const RAD_TO_DEG = 180 / Math.PI;
const SMALL_ANGLE_THRESHOLD_RAD = 1e-6;
const SIDE_OFFSET_EPSILON_M = 0.001;

const ZERO_STEP_DELTA: OdometryStepDelta = Object.freeze({
  leftRadians: 0,
  rightRadians: 0,
  leftMeters: 0,
  rightMeters: 0,
  linearMeters: 0,
  angularRadians: 0,
  dtSeconds: 0,
});

const EMPTY_CHANNEL_SNAPSHOT: OdometryEncoderChannelSnapshot = Object.freeze({
  encoderCount: 0,
  readyCount: 0,
  cumulativeRadians: 0,
});

export interface OdometryBaseline {
  readonly initialized: boolean;
  readonly leftRadians: number;
  readonly rightRadians: number;
}

export interface OdometryMeasurementInput {
  /**
   * Direct angular wheel measurements in radians (scalar for 2WD or array of paired
   * wheel encoders for 4WD aggregation on each side). When provided alongside sensor
   * descriptors, arrays take precedence cleanly.
   */
  readonly leftAnglesRad?: number | readonly number[];
  readonly rightAnglesRad?: number | readonly number[];
  /** Installed sensor descriptors used to validate left/right encoder presence and power state. */
  readonly descriptors?: readonly SensorDescriptor[];
  /** Cumulative wheel encoder angle state driven strictly from wheel shaft rotation. */
  readonly accumulator?: EncoderAccumulatorState;
  /** Optional explicit readiness overrides for standalone hardware checks. */
  readonly forceUnavailableStatus?: Exclude<
    OdometryStatus,
    "ready" | "uninitialized"
  >;
  readonly unavailableReason?: string;
}

function normalizeHeading(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  let angle = radians % (2 * Math.PI);
  if (angle > Math.PI) {
    angle -= 2 * Math.PI;
  } else if (angle <= -Math.PI) {
    angle += 2 * Math.PI;
  }
  return Object.is(angle, -0) ? 0 : angle;
}

function normalizePose(
  pose?: Partial<Pick<OdometryPose, "xMeters" | "zMeters" | "headingRadians">>
): OdometryPose {
  const xMeters =
    pose?.xMeters !== undefined && Number.isFinite(pose.xMeters) ? pose.xMeters : 0;
  const zMeters =
    pose?.zMeters !== undefined && Number.isFinite(pose.zMeters) ? pose.zMeters : 0;
  const headingRadians =
    pose?.headingRadians !== undefined && Number.isFinite(pose.headingRadians)
      ? normalizeHeading(pose.headingRadians)
      : 0;
  return {
    xMeters: Object.is(xMeters, -0) ? 0 : xMeters,
    zMeters: Object.is(zMeters, -0) ? 0 : zMeters,
    headingRadians,
    headingDegrees: headingRadians * RAD_TO_DEG,
  };
}

function computeSideMeanAngle(
  raw: number | readonly number[]
): { readonly ok: boolean; readonly count: number; readonly meanRadians: number; readonly error?: string } {
  const list = typeof raw === "number" ? [raw] : raw;
  if (list.length === 0) {
    return {
      ok: false,
      count: 0,
      meanRadians: 0,
      error: "Encoder side measurement array is empty.",
    };
  }
  let sum = 0;
  for (const angle of list) {
    if (typeof angle !== "number" || !Number.isFinite(angle)) {
      return {
        ok: false,
        count: list.length,
        meanRadians: 0,
        error: `Non-finite wheel encoder angle (${String(angle)}).`,
      };
    }
    sum += angle;
  }
  return {
    ok: true,
    count: list.length,
    meanRadians: sum / list.length,
  };
}

export function resolveOdometryEncoderChannels(
  measurement: OdometryMeasurementInput
): {
  readonly ok: boolean;
  readonly status: OdometryStatus;
  readonly leftChannel: OdometryEncoderChannelSnapshot;
  readonly rightChannel: OdometryEncoderChannelSnapshot;
  readonly warnings: readonly string[];
  readonly error?: string;
} {
  const warnings: string[] = [];

  if (measurement.forceUnavailableStatus) {
    return {
      ok: false,
      status: measurement.forceUnavailableStatus,
      leftChannel: EMPTY_CHANNEL_SNAPSHOT,
      rightChannel: EMPTY_CHANNEL_SNAPSHOT,
      warnings,
      error:
        measurement.unavailableReason ??
        `Wheel encoders unavailable (${measurement.forceUnavailableStatus}).`,
    };
  }

  // Case 1: Explicit numeric encoder arrays / readings (unit or hardware-bypassed telemetry)
  if (
    measurement.leftAnglesRad !== undefined ||
    measurement.rightAnglesRad !== undefined
  ) {
    if (
      measurement.leftAnglesRad === undefined ||
      measurement.rightAnglesRad === undefined
    ) {
      return {
        ok: false,
        status: "unavailable-encoders",
        leftChannel: EMPTY_CHANNEL_SNAPSHOT,
        rightChannel: EMPTY_CHANNEL_SNAPSHOT,
        warnings,
        error: "Differential odometry requires both left and right encoder readings.",
      };
    }
    const leftRes = computeSideMeanAngle(measurement.leftAnglesRad);
    const rightRes = computeSideMeanAngle(measurement.rightAnglesRad);
    if (!leftRes.ok || !rightRes.ok) {
      return {
        ok: false,
        status: "unavailable-encoders",
        leftChannel: {
          encoderCount: leftRes.count,
          readyCount: leftRes.ok ? leftRes.count : 0,
          cumulativeRadians: 0,
        },
        rightChannel: {
          encoderCount: rightRes.count,
          readyCount: rightRes.ok ? rightRes.count : 0,
          cumulativeRadians: 0,
        },
        warnings,
        error: leftRes.error ?? rightRes.error ?? "Invalid encoder readings.",
      };
    }

    return {
      ok: true,
      status: "ready",
      leftChannel: {
        encoderCount: leftRes.count,
        readyCount: leftRes.count,
        cumulativeRadians: leftRes.meanRadians,
      },
      rightChannel: {
        encoderCount: rightRes.count,
        readyCount: rightRes.count,
        cumulativeRadians: rightRes.meanRadians,
      },
      warnings,
    };
  }

  // Case 2: Resolve installed physical encoders from SensorDescriptor[] + EncoderAccumulatorState
  const descriptors = measurement.descriptors ?? [];
  const encoders = descriptors.filter((d) => d.sensorKind === "encoder");
  const leftEncoders = encoders.filter(
    (d) => d.localMountOffset.z > SIDE_OFFSET_EPSILON_M
  );
  const rightEncoders = encoders.filter(
    (d) => d.localMountOffset.z < -SIDE_OFFSET_EPSILON_M
  );

  if (leftEncoders.length === 0 || rightEncoders.length === 0) {
    const reason =
      encoders.length === 0
        ? "No wheel encoders installed on assembly; install left and right quadrature encoders to enable odometry."
        : "Odometry requires at least one wheel encoder mounted on each side (+Z left and -Z right).";
    return {
      ok: false,
      status: "unavailable-encoders",
      leftChannel: {
        encoderCount: leftEncoders.length,
        readyCount: leftEncoders.filter((e) => e.availability === "ready").length,
        cumulativeRadians: 0,
      },
      rightChannel: {
        encoderCount: rightEncoders.length,
        readyCount: rightEncoders.filter((e) => e.availability === "ready").length,
        cumulativeRadians: 0,
      },
      warnings,
      error: reason,
    };
  }

  const readyLeft = leftEncoders.filter((e) => e.availability === "ready");
  const readyRight = rightEncoders.filter((e) => e.availability === "ready");

  if (readyLeft.length === 0 || readyRight.length === 0) {
    const blockedEncoders = [...leftEncoders, ...rightEncoders].filter(
      (e) => e.availability !== "ready"
    );
    const hasElectricalFault = blockedEncoders.some(
      (e) => e.availability === "unavailable-electrical-fault"
    );
    const status: OdometryStatus = hasElectricalFault
      ? "unavailable-electrical-fault"
      : "unavailable-unpowered";
    const reason =
      blockedEncoders[0]?.availabilityReason ??
      "Wheel encoder electrical supply or signal path unavailable.";

    return {
      ok: false,
      status,
      leftChannel: {
        encoderCount: leftEncoders.length,
        readyCount: readyLeft.length,
        cumulativeRadians: 0,
      },
      rightChannel: {
        encoderCount: rightEncoders.length,
        readyCount: readyRight.length,
        cumulativeRadians: 0,
      },
      warnings,
      error: reason,
    };
  }

  if (readyLeft.length < leftEncoders.length) {
    warnings.push(
      `Left drive side has ${leftEncoders.length - readyLeft.length} degraded/unpowered encoder(s); aggregating remaining ready left encoder(s).`
    );
  }
  if (readyRight.length < rightEncoders.length) {
    warnings.push(
      `Right drive side has ${rightEncoders.length - readyRight.length} degraded/unpowered encoder(s); aggregating remaining ready right encoder(s).`
    );
  }

  const acc = measurement.accumulator;
  if (
    !acc ||
    !Number.isFinite(acc.leftRadians) ||
    !Number.isFinite(acc.rightRadians)
  ) {
    return {
      ok: false,
      status: "unavailable-encoders",
      leftChannel: {
        encoderCount: leftEncoders.length,
        readyCount: readyLeft.length,
        cumulativeRadians: 0,
      },
      rightChannel: {
        encoderCount: rightEncoders.length,
        readyCount: readyRight.length,
        cumulativeRadians: 0,
      },
      warnings,
      error: "Wheel encoder accumulator measurements are missing or non-finite.",
    };
  }

  return {
    ok: true,
    status: "ready",
    leftChannel: {
      encoderCount: leftEncoders.length,
      readyCount: readyLeft.length,
      cumulativeRadians: acc.leftRadians,
    },
    rightChannel: {
      encoderCount: rightEncoders.length,
      readyCount: readyRight.length,
      cumulativeRadians: acc.rightRadians,
    },
    warnings,
  };
}

/**
 * Pure exact constant-curvature arc integration for 2D differential drive (+X forward, +Z left, +CCW heading),
 * switching seamlessly to a 4th-order Taylor sinc approximation when |deltaTheta| < 1e-6 rad.
 */
export function integrateDifferentialDriveDelta(params: {
  readonly pose: OdometryPose;
  readonly deltaLeftMeters: number;
  readonly deltaRightMeters: number;
  readonly trackWidthM: number;
}): {
  readonly pose: OdometryPose;
  readonly linearMeters: number;
  readonly angularRadians: number;
} {
  const { pose, deltaLeftMeters, deltaRightMeters, trackWidthM } = params;
  const linearMeters = (deltaLeftMeters + deltaRightMeters) * 0.5;
  const angularRadians = (deltaRightMeters - deltaLeftMeters) / trackWidthM;

  const halfDelta = angularRadians * 0.5;
  const sincHalf =
    Math.abs(angularRadians) >= SMALL_ANGLE_THRESHOLD_RAD
      ? Math.sin(halfDelta) / halfDelta
      : 1 - (halfDelta * halfDelta) / 6;

  const midHeading = pose.headingRadians + halfDelta;
  const effectiveChord = linearMeters * sincHalf;
  const nextX = pose.xMeters + effectiveChord * Math.cos(midHeading);
  const nextZ = pose.zMeters + effectiveChord * Math.sin(midHeading);
  const nextHeading = normalizeHeading(pose.headingRadians + angularRadians);

  return {
    pose: {
      xMeters: Object.is(nextX, -0) ? 0 : nextX,
      zMeters: Object.is(nextZ, -0) ? 0 : nextZ,
      headingRadians: nextHeading,
      headingDegrees: nextHeading * RAD_TO_DEG,
    },
    linearMeters: Object.is(linearMeters, -0) ? 0 : linearMeters,
    angularRadians: Object.is(angularRadians, -0) ? 0 : angularRadians,
  };
}

function hasValidOdometryGeometry(model: DifferentialDriveModel | null | undefined): boolean {
  return Boolean(
    model &&
      model.isValid &&
      Number.isFinite(model.trackWidthM) &&
      model.trackWidthM > 0 &&
      Number.isFinite(model.left.effectiveWheelRadiusM) &&
      model.left.effectiveWheelRadiusM > 0 &&
      Number.isFinite(model.right.effectiveWheelRadiusM) &&
      model.right.effectiveWheelRadiusM > 0
  );
}

/**
 * Creates a clean initial odometry state and matching baseline snapshot.
 */
export function createInitialOdometrySession(options?: {
  readonly initialPose?: Partial<Pick<OdometryPose, "xMeters" | "zMeters" | "headingRadians">>;
  readonly model?: DifferentialDriveModel | null;
  readonly initialMeasurement?: OdometryMeasurementInput;
  readonly timestampSeconds?: number;
}): {
  readonly state: DifferentialDriveOdometryState;
  readonly baseline: OdometryBaseline;
} {
  const pose = normalizePose(options?.initialPose);
  const timestamp =
    options?.timestampSeconds !== undefined &&
    Number.isFinite(options.timestampSeconds)
      ? options.timestampSeconds
      : 0;

  if (options?.model !== undefined && !hasValidOdometryGeometry(options.model)) {
    return {
      state: {
        isValid: false,
        status: "invalid-geometry",
        pose,
        velocity: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
        leftDistanceMeters: 0,
        rightDistanceMeters: 0,
        traveledDistanceMeters: 0,
        leftChannel: EMPTY_CHANNEL_SNAPSHOT,
        rightChannel: EMPTY_CHANNEL_SNAPSHOT,
        lastStep: ZERO_STEP_DELTA,
        updateCount: 0,
        timestampSeconds: timestamp,
        warnings: [],
        error:
          options.model?.errors[0] ??
          "Invalid or unsupported differential-drive geometry for odometry.",
      },
      baseline: { initialized: false, leftRadians: 0, rightRadians: 0 },
    };
  }

  if (options?.initialMeasurement) {
    const channels = resolveOdometryEncoderChannels(options.initialMeasurement);
    if (!channels.ok) {
      return {
        state: {
          isValid: false,
          status: channels.status,
          pose,
          velocity: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
          leftDistanceMeters: 0,
          rightDistanceMeters: 0,
          traveledDistanceMeters: 0,
          leftChannel: channels.leftChannel,
          rightChannel: channels.rightChannel,
          lastStep: ZERO_STEP_DELTA,
          updateCount: 0,
          timestampSeconds: timestamp,
          warnings: channels.warnings,
          error: channels.error,
        },
        baseline: { initialized: false, leftRadians: 0, rightRadians: 0 },
      };
    }

    return {
      state: {
        isValid: true,
        status: "ready",
        pose,
        velocity: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
        leftDistanceMeters: 0,
        rightDistanceMeters: 0,
        traveledDistanceMeters: 0,
        leftChannel: channels.leftChannel,
        rightChannel: channels.rightChannel,
        lastStep: ZERO_STEP_DELTA,
        updateCount: 0,
        timestampSeconds: timestamp,
        warnings: channels.warnings,
      },
      baseline: {
        initialized: true,
        leftRadians: channels.leftChannel.cumulativeRadians,
        rightRadians: channels.rightChannel.cumulativeRadians,
      },
    };
  }

  return {
    state: {
      isValid: true,
      status: "uninitialized",
      pose,
      velocity: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
      leftDistanceMeters: 0,
      rightDistanceMeters: 0,
      traveledDistanceMeters: 0,
      leftChannel: EMPTY_CHANNEL_SNAPSHOT,
      rightChannel: EMPTY_CHANNEL_SNAPSHOT,
      lastStep: ZERO_STEP_DELTA,
      updateCount: 0,
      timestampSeconds: timestamp,
      warnings: [],
    },
    baseline: { initialized: false, leftRadians: 0, rightRadians: 0 },
  };
}

/**
 * Pure deterministic odometry update consuming cumulative wheel encoder readings and
 * differential-drive geometry (`trackWidthM`, effective left/right wheel radii) without
 * touching ground-truth SimulationState pose.
 */
export function stepDifferentialDriveOdometry(params: {
  readonly state: DifferentialDriveOdometryState;
  readonly baseline: OdometryBaseline;
  readonly model: DifferentialDriveModel | null | undefined;
  readonly measurement: OdometryMeasurementInput;
  readonly timestampSeconds: number;
}): {
  readonly state: DifferentialDriveOdometryState;
  readonly baseline: OdometryBaseline;
} {
  const { state, baseline, model, measurement, timestampSeconds } = params;
  const safeTimestamp = Number.isFinite(timestampSeconds)
    ? timestampSeconds
    : state.timestampSeconds;

  if (!hasValidOdometryGeometry(model)) {
    return {
      state: {
        ...state,
        isValid: false,
        status: "invalid-geometry",
        velocity: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
        lastStep: ZERO_STEP_DELTA,
        timestampSeconds: safeTimestamp,
        error:
          model?.errors[0] ??
          "Invalid or unsupported differential-drive geometry for odometry.",
      },
      baseline,
    };
  }

  const channels = resolveOdometryEncoderChannels(measurement);
  if (!channels.ok) {
    return {
      state: {
        ...state,
        isValid: false,
        status: channels.status,
        velocity: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
        leftChannel: channels.leftChannel,
        rightChannel: channels.rightChannel,
        lastStep: ZERO_STEP_DELTA,
        timestampSeconds: safeTimestamp,
        warnings: channels.warnings,
        error: channels.error,
      },
      // Do not advance encoder baseline while encoder channel is unavailable
      baseline,
    };
  }

  // First valid observation initializes encoder baseline cleanly without fabricating displacement
  if (!baseline.initialized) {
    return {
      state: {
        ...state,
        isValid: true,
        status: "ready",
        velocity: { linearVelocityMps: 0, angularVelocityRadPerSec: 0 },
        leftChannel: channels.leftChannel,
        rightChannel: channels.rightChannel,
        lastStep: ZERO_STEP_DELTA,
        timestampSeconds: safeTimestamp,
        warnings: channels.warnings,
        error: undefined,
      },
      baseline: {
        initialized: true,
        leftRadians: channels.leftChannel.cumulativeRadians,
        rightRadians: channels.rightChannel.cumulativeRadians,
      },
    };
  }

  const deltaLeftRadians =
    channels.leftChannel.cumulativeRadians - baseline.leftRadians;
  const deltaRightRadians =
    channels.rightChannel.cumulativeRadians - baseline.rightRadians;
  const deltaLeftMeters = deltaLeftRadians * model!.left.effectiveWheelRadiusM;
  const deltaRightMeters = deltaRightRadians * model!.right.effectiveWheelRadiusM;

  const integrated = integrateDifferentialDriveDelta({
    pose: state.pose,
    deltaLeftMeters,
    deltaRightMeters,
    trackWidthM: model!.trackWidthM,
  });

  const dtSeconds = Math.max(0, safeTimestamp - state.timestampSeconds);
  const linearVelocityMps =
    dtSeconds > 1e-9 ? integrated.linearMeters / dtSeconds : 0;
  const angularVelocityRadPerSec =
    dtSeconds > 1e-9 ? integrated.angularRadians / dtSeconds : 0;

  return {
    state: {
      isValid: true,
      status: "ready",
      pose: integrated.pose,
      velocity: {
        linearVelocityMps: Object.is(linearVelocityMps, -0) ? 0 : linearVelocityMps,
        angularVelocityRadPerSec: Object.is(angularVelocityRadPerSec, -0)
          ? 0
          : angularVelocityRadPerSec,
      },
      leftDistanceMeters: state.leftDistanceMeters + deltaLeftMeters,
      rightDistanceMeters: state.rightDistanceMeters + deltaRightMeters,
      traveledDistanceMeters:
        state.traveledDistanceMeters + Math.abs(integrated.linearMeters),
      leftChannel: channels.leftChannel,
      rightChannel: channels.rightChannel,
      lastStep: {
        leftRadians: deltaLeftRadians,
        rightRadians: deltaRightRadians,
        leftMeters: deltaLeftMeters,
        rightMeters: deltaRightMeters,
        linearMeters: integrated.linearMeters,
        angularRadians: integrated.angularRadians,
        dtSeconds,
      },
      updateCount: state.updateCount + 1,
      timestampSeconds: safeTimestamp,
      warnings: channels.warnings,
    },
    baseline: {
      initialized: true,
      leftRadians: channels.leftChannel.cumulativeRadians,
      rightRadians: channels.rightChannel.cumulativeRadians,
    },
  };
}

/**
 * Stateful deterministic differential-drive odometry tracker for control/simulation sessions.
 */
export class DifferentialDriveOdometryTracker {
  private state: DifferentialDriveOdometryState;
  private baseline: OdometryBaseline;

  constructor(options?: Parameters<typeof createInitialOdometrySession>[0]) {
    const initial = createInitialOdometrySession(options);
    this.state = initial.state;
    this.baseline = initial.baseline;
  }

  getState(): DifferentialDriveOdometryState {
    return this.state;
  }

  reset(options?: {
    readonly initialPose?: Partial<Pick<OdometryPose, "xMeters" | "zMeters" | "headingRadians">>;
    readonly model?: DifferentialDriveModel | null;
    readonly initialMeasurement?: OdometryMeasurementInput;
    readonly timestampSeconds?: number;
  }): DifferentialDriveOdometryState {
    const initial = createInitialOdometrySession(options);
    this.state = initial.state;
    this.baseline = initial.baseline;
    return this.state;
  }

  update(
    model: DifferentialDriveModel | null | undefined,
    measurement: OdometryMeasurementInput,
    timestampSeconds: number
  ): DifferentialDriveOdometryState {
    const res = stepDifferentialDriveOdometry({
      state: this.state,
      baseline: this.baseline,
      model,
      measurement,
      timestampSeconds,
    });
    this.state = res.state;
    this.baseline = res.baseline;
    return this.state;
  }
}
