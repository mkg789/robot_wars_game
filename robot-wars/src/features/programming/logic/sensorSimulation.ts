import { resolveSurfaceAtPoint } from "../../simulation/logic/arenaModel";
import { DEFAULT_GROUND_SURFACE } from "../../simulation/logic/surfaceModel";
import type { ArenaBarrier, ArenaConfig } from "../../simulation/types/arena.types";
import type { SimulationRobotConfig, SimulationState } from "../../simulation/types/simulation.types";
import type {
  EncoderAccumulatorState,
  EncoderData,
  ImuData,
  IrProximityData,
  LineSensorData,
  RobotSensorsSnapshot,
  SensorDescriptor,
  SensorReadResult,
  SupportedSensorKind,
  UltrasonicDistanceData,
} from "../types/sensor.types";

const RAD_TO_DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;
const DEFAULT_ENCODER_TICKS_PER_REV = 360;
const DEFAULT_IR_THRESHOLD_METERS = 0.35;

/**
 * Computes deterministic 2D ray-to-oriented-rectangle intersection distance in arena X-Z.
 * Returns null if the ray misses or points away from the barrier.
 */
function intersectRayWithBarrier(
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  barrier: ArenaBarrier
): number | null {
  const rot = barrier.rotationRadians ?? 0;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);

  const relX = originX - barrier.position.x;
  const relZ = originZ - barrier.position.z;

  const localOx = relX * cos - relZ * sin;
  const localOz = relX * sin + relZ * cos;
  const localDx = dirX * cos - dirZ * sin;
  const localDz = dirX * sin + dirZ * cos;

  const halfX = barrier.sizeX / 2;
  const halfZ = barrier.sizeZ / 2;

  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;

  // X slab
  if (Math.abs(localDx) < 1e-12) {
    if (localOx < -halfX || localOx > halfX) return null;
  } else {
    const inv = 1 / localDx;
    let t1 = (-halfX - localOx) * inv;
    let t2 = (halfX - localOx) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  // Z slab
  if (Math.abs(localDz) < 1e-12) {
    if (localOz < -halfZ || localOz > halfZ) return null;
  } else {
    const inv = 1 / localDz;
    let t1 = (-halfZ - localOz) * inv;
    let t2 = (halfZ - localOz) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin >= 0 ? tMin : null;
}

/**
 * Transforms sensor local pose to arena world coordinates and heading direction,
 * matching Robot Wars physics frame (+X forward, +Z left).
 */
export function resolveSensorWorldPose(
  sensor: SensorDescriptor,
  simState: SimulationState
): {
  readonly worldX: number;
  readonly worldZ: number;
  readonly dirX: number;
  readonly dirZ: number;
} {
  const cosH = Math.cos(simState.headingRadians);
  const sinH = Math.sin(simState.headingRadians);
  const worldX =
    simState.xMeters +
    sensor.localMountOffset.x * cosH -
    sensor.localMountOffset.z * sinH;
  const worldZ =
    simState.zMeters +
    sensor.localMountOffset.x * sinH +
    sensor.localMountOffset.z * cosH;

  const worldYaw = simState.headingRadians + sensor.mountYawOffsetRadians;
  return {
    worldX,
    worldZ,
    dirX: Math.cos(worldYaw),
    dirZ: Math.sin(worldYaw),
  };
}

export function raycastNearestObstacle(params: {
  readonly originX: number;
  readonly originZ: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly arena: ArenaConfig;
  readonly maxRangeMeters: number;
}): { readonly distanceMeters: number | null; readonly hitBarrierId: string | null } {
  const { originX, originZ, dirX, dirZ, arena, maxRangeMeters } = params;
  const obstacles: readonly ArenaBarrier[] = [
    ...arena.barriers,
    ...arena.boundary.perimeterWalls,
  ];

  let nearestDist: number | null = null;
  let nearestId: string | null = null;

  for (const barrier of obstacles) {
    const hitT = intersectRayWithBarrier(originX, originZ, dirX, dirZ, barrier);
    if (
      hitT !== null &&
      hitT <= maxRangeMeters &&
      (nearestDist === null || hitT < nearestDist)
    ) {
      nearestDist = hitT;
      nearestId = barrier.id;
    }
  }

  return {
    distanceMeters: nearestDist,
    hitBarrierId: nearestId,
  };
}

function makeUnavailableResult<T>(params: {
  readonly sensorKind: SupportedSensorKind;
  readonly descriptor: SensorDescriptor | null;
  readonly timestampSeconds: number;
  readonly reason: string;
}): SensorReadResult<T> {
  return {
    ok: false,
    status: params.descriptor?.availability ?? "not-installed",
    sensorId: params.descriptor?.sensorId ?? null,
    sensorName: params.descriptor?.name ?? null,
    sensorKind: params.sensorKind,
    timestampSeconds: params.timestampSeconds,
    reason: params.reason,
    assumptions: params.descriptor?.assumptions ?? [],
    data: null,
  };
}

function findSensorByKindOrId(
  descriptors: readonly SensorDescriptor[],
  kinds: readonly SupportedSensorKind[],
  sensorId?: string
): { descriptor: SensorDescriptor | null; error?: string } {
  if (sensorId) {
    const match = descriptors.find((d) => d.sensorId === sensorId);
    if (!match) {
      return {
        descriptor: null,
        error: `Sensor "${sensorId}" is not installed on this robot.`,
      };
    }
    if (!kinds.includes(match.sensorKind)) {
      return {
        descriptor: match,
        error: `Sensor "${match.name}" (${match.sensorKind}) does not match requested sensor type (${kinds.join("/")}).`,
      };
    }
    return { descriptor: match };
  }

  const firstReady = descriptors.find(
    (d) => kinds.includes(d.sensorKind) && d.availability === "ready"
  );
  const firstAny = firstReady ?? descriptors.find((d) => kinds.includes(d.sensorKind));
  if (!firstAny) {
    return {
      descriptor: null,
      error: `No installed sensor of type ${kinds.join("/")} found on robot.`,
    };
  }
  return { descriptor: firstAny };
}

export function simulateDistanceSensor(params: {
  readonly descriptors: readonly SensorDescriptor[];
  readonly simState: SimulationState;
  readonly arena: ArenaConfig;
  readonly sensorId?: string;
}): SensorReadResult<UltrasonicDistanceData> {
  const { descriptors, simState, arena, sensorId } = params;
  const { descriptor, error } = findSensorByKindOrId(
    descriptors,
    ["ultrasonic", "tof-distance"],
    sensorId
  );

  if (!descriptor || error) {
    return makeUnavailableResult({
      sensorKind: descriptor?.sensorKind ?? "ultrasonic",
      descriptor,
      timestampSeconds: simState.timeSeconds,
      reason: error ?? "No distance sensor installed.",
    });
  }

  if (descriptor.availability !== "ready") {
    return makeUnavailableResult({
      sensorKind: descriptor.sensorKind,
      descriptor,
      timestampSeconds: simState.timeSeconds,
      reason:
        descriptor.availabilityReason ??
        `Sensor unavailable (${descriptor.availability}).`,
    });
  }

  const isTof = descriptor.sensorKind === "tof-distance";
  const minRangeMeters = isTof ? 0.03 : 0.02;
  const maxRangeMeters = isTof ? 2.0 : 4.0;
  const pose = resolveSensorWorldPose(descriptor, simState);
  const ray = raycastNearestObstacle({
    originX: pose.worldX,
    originZ: pose.worldZ,
    dirX: pose.dirX,
    dirZ: pose.dirZ,
    arena,
    maxRangeMeters,
  });

  const measuredMeters =
    ray.distanceMeters !== null
      ? Math.max(minRangeMeters, Number(ray.distanceMeters.toFixed(4)))
      : maxRangeMeters;

  return {
    ok: true,
    status: "ready",
    sensorId: descriptor.sensorId,
    sensorName: descriptor.name,
    sensorKind: descriptor.sensorKind,
    timestampSeconds: simState.timeSeconds,
    assumptions: [
      ...descriptor.assumptions,
      `Ideal thin-ray 2D X-Z projection (${minRangeMeters * 100}cm–${maxRangeMeters}m range); beam cone dispersion and acoustic surface absorption omitted.`,
    ],
    data: {
      distanceMeters: measuredMeters,
      distanceCm: Number((measuredMeters * 100).toFixed(2)),
      inRange: ray.distanceMeters !== null,
      minRangeMeters,
      maxRangeMeters,
      hitBarrierId: ray.hitBarrierId,
    },
  };
}

export function simulateIrProximitySensor(params: {
  readonly descriptors: readonly SensorDescriptor[];
  readonly simState: SimulationState;
  readonly arena: ArenaConfig;
  readonly sensorId?: string;
}): SensorReadResult<IrProximityData> {
  const { descriptors, simState, arena, sensorId } = params;
  const { descriptor, error } = findSensorByKindOrId(
    descriptors,
    ["ir-proximity"],
    sensorId
  );

  if (!descriptor || error) {
    return makeUnavailableResult({
      sensorKind: "ir-proximity",
      descriptor,
      timestampSeconds: simState.timeSeconds,
      reason: error ?? "No IR proximity sensor installed.",
    });
  }

  if (descriptor.availability !== "ready") {
    return makeUnavailableResult({
      sensorKind: "ir-proximity",
      descriptor,
      timestampSeconds: simState.timeSeconds,
      reason:
        descriptor.availabilityReason ??
        `IR sensor unavailable (${descriptor.availability}).`,
    });
  }

  const pose = resolveSensorWorldPose(descriptor, simState);
  const ray = raycastNearestObstacle({
    originX: pose.worldX,
    originZ: pose.worldZ,
    dirX: pose.dirX,
    dirZ: pose.dirZ,
    arena,
    maxRangeMeters: DEFAULT_IR_THRESHOLD_METERS,
  });

  const detected = ray.distanceMeters !== null;
  const normalizedStrength =
    ray.distanceMeters !== null
      ? Number(
          Math.max(
            0,
            Math.min(1, 1 - ray.distanceMeters / DEFAULT_IR_THRESHOLD_METERS)
          ).toFixed(3)
        )
      : 0;

  return {
    ok: true,
    status: "ready",
    sensorId: descriptor.sensorId,
    sensorName: descriptor.name,
    sensorKind: "ir-proximity",
    timestampSeconds: simState.timeSeconds,
    assumptions: [
      ...descriptor.assumptions,
      `Simplified IR proximity threshold assumed at ${(DEFAULT_IR_THRESHOLD_METERS * 100).toFixed(0)} cm; ambient IR interference and target albedo omitted.`,
    ],
    data: {
      detected,
      distanceMeters:
        ray.distanceMeters !== null ? Number(ray.distanceMeters.toFixed(4)) : null,
      thresholdMeters: DEFAULT_IR_THRESHOLD_METERS,
      normalizedStrength,
      hitBarrierId: ray.hitBarrierId,
    },
  };
}

function isSurfaceDarkOrLineZone(
  surfaceId: string,
  surfaceName: string,
  fallbackId: string
): boolean {
  const lower = `${surfaceId} ${surfaceName}`.toLowerCase();
  if (
    lower.includes("line") ||
    lower.includes("track") ||
    lower.includes("tape") ||
    lower.includes("marking")
  ) {
    return true;
  }
  return surfaceId !== fallbackId;
}

export function simulateLineSensor(params: {
  readonly descriptors: readonly SensorDescriptor[];
  readonly simState: SimulationState;
  readonly arena: ArenaConfig;
  readonly sensorId?: string;
}): SensorReadResult<LineSensorData> {
  const { descriptors, simState, arena, sensorId } = params;
  const { descriptor, error } = findSensorByKindOrId(
    descriptors,
    ["line-sensor"],
    sensorId
  );

  if (!descriptor || error) {
    return makeUnavailableResult({
      sensorKind: "line-sensor",
      descriptor,
      timestampSeconds: simState.timeSeconds,
      reason: error ?? "No line sensor installed.",
    });
  }

  if (descriptor.availability !== "ready") {
    return makeUnavailableResult({
      sensorKind: "line-sensor",
      descriptor,
      timestampSeconds: simState.timeSeconds,
      reason:
        descriptor.availabilityReason ??
        `Line sensor unavailable (${descriptor.availability}).`,
    });
  }

  const cosH = Math.cos(simState.headingRadians);
  const sinH = Math.sin(simState.headingRadians);
  const sensorYaw = simState.headingRadians + descriptor.mountYawOffsetRadians;
  const cosS = Math.cos(sensorYaw);
  const sinS = Math.sin(sensorYaw);
  const fallbackSurfaceId =
    typeof arena.fallbackSurface === "string"
      ? arena.fallbackSurface
      : arena.fallbackSurface?.id ?? DEFAULT_GROUND_SURFACE.id;

  const centerX =
    simState.xMeters +
    descriptor.localMountOffset.x * cosH -
    descriptor.localMountOffset.z * sinH;
  const centerZ =
    simState.zMeters +
    descriptor.localMountOffset.x * sinH +
    descriptor.localMountOffset.z * cosH;

  // 5 lateral probe channels evenly spanning the mounted sensor array's local +Z axis
  const channelCount = 5;
  const halfSpan = Math.min(0.12, descriptor.spanWidthMeters) * 0.5;
  const channels: boolean[] = [];
  const activePositions: number[] = [];

  for (let i = 0; i < channelCount; i++) {
    const frac = 1 - (2 * i) / (channelCount - 1); // +1 left .. -1 right
    const offset = frac * halfSpan;
    const sampleX = centerX - offset * sinS;
    const sampleZ = centerZ + offset * cosS;
    const surf = resolveSurfaceAtPoint(arena, sampleX, sampleZ);
    const hit = isSurfaceDarkOrLineZone(surf.id, surf.name, fallbackSurfaceId);
    channels.push(hit);
    if (hit) activePositions.push(frac);
  }

  const centerSurface = resolveSurfaceAtPoint(arena, centerX, centerZ);

  const detected = channels.some(Boolean);
  const lineOffsetNormalized =
    activePositions.length > 0
      ? Number(
          (
            activePositions.reduce((a, b) => a + b, 0) / activePositions.length
          ).toFixed(3)
        )
      : null;

  return {
    ok: true,
    status: "ready",
    sensorId: descriptor.sensorId,
    sensorName: descriptor.name,
    sensorKind: "line-sensor",
    timestampSeconds: simState.timeSeconds,
    assumptions: [
      ...descriptor.assumptions,
      "Minimal deterministic line model queries arena surface zones across 5 lateral sensor offsets; line detection triggers on distinct non-fallback zones or named line/track/marking zones.",
    ],
    data: {
      detected,
      surfaceId: centerSurface.id,
      surfaceName: centerSurface.name,
      channels,
      lineOffsetNormalized,
    },
  };
}

export function simulateImuSensor(params: {
  readonly descriptors: readonly SensorDescriptor[];
  readonly simState: SimulationState;
  readonly sensorId?: string;
}): SensorReadResult<ImuData> {
  const { descriptors, simState, sensorId } = params;
  const { descriptor, error } = findSensorByKindOrId(
    descriptors,
    ["imu", "accelerometer", "gyroscope"],
    sensorId
  );

  if (!descriptor || error) {
    return makeUnavailableResult({
      sensorKind: descriptor?.sensorKind ?? "imu",
      descriptor,
      timestampSeconds: simState.timeSeconds,
      reason: error ?? "No IMU / inertial sensor installed.",
    });
  }

  if (descriptor.availability !== "ready") {
    return makeUnavailableResult({
      sensorKind: descriptor.sensorKind,
      descriptor,
      timestampSeconds: simState.timeSeconds,
      reason:
        descriptor.availabilityReason ??
        `IMU unavailable (${descriptor.availability}).`,
    });
  }

  const isGyroOnly = descriptor.sensorKind === "gyroscope";
  const isAccelOnly = descriptor.sensorKind === "accelerometer";
  const centripetalLatAccel =
    simState.longitudinalVelocityMps * simState.yawRateRadPerSec;

  return {
    ok: true,
    status: "ready",
    sensorId: descriptor.sensorId,
    sensorName: descriptor.name,
    sensorKind: descriptor.sensorKind,
    timestampSeconds: simState.timeSeconds,
    assumptions: [
      ...descriptor.assumptions,
      "Planar 2D X-Z IMU model derives noise-free yaw, yaw-rate, longitudinal acceleration, and centripetal lateral acceleration from SimulationState (pitch/roll fixed at 0).",
    ],
    data: {
      headingRadians: isAccelOnly ? 0 : simState.headingRadians,
      headingDegrees: isAccelOnly ? 0 : simState.headingRadians * RAD_TO_DEG,
      yawRateRadPerSec: isAccelOnly ? 0 : simState.yawRateRadPerSec,
      yawRateDegPerSec: isAccelOnly ? 0 : simState.yawRateRadPerSec * RAD_TO_DEG,
      longitudinalAccelerationMps2: isGyroOnly
        ? 0
        : simState.longitudinalAccelerationMps2,
      lateralAccelerationMps2: isGyroOnly ? 0 : Number(centripetalLatAccel.toFixed(4)),
      angularAccelerationRadPerSec2: isAccelOnly
        ? 0
        : simState.angularAccelerationRadPerSec2,
    },
  };
}

export function simulateEncoderSensor(params: {
  readonly descriptors: readonly SensorDescriptor[];
  readonly robotConfig: SimulationRobotConfig;
  readonly simState: SimulationState;
  readonly accumulator: EncoderAccumulatorState;
  readonly sideOrSensorId?: "left" | "right" | "average" | string;
}): SensorReadResult<EncoderData> {
  const { descriptors, simState, accumulator, sideOrSensorId = "average" } = params;

  const isSideKeyword =
    sideOrSensorId === "left" ||
    sideOrSensorId === "right" ||
    sideOrSensorId === "average";

  const { descriptor, error } = findSensorByKindOrId(
    descriptors,
    ["encoder"],
    isSideKeyword ? undefined : sideOrSensorId
  );

  // If explicit side requested and multiple encoders exist, pick one matching side by mount +Z/-Z sign
  let resolvedDescriptor = descriptor;
  if (isSideKeyword && sideOrSensorId !== "average") {
    const encoderList = descriptors.filter((d) => d.sensorKind === "encoder");
    const sideMatch = encoderList.find((d) =>
      sideOrSensorId === "left"
        ? d.localMountOffset.z >= 0
        : d.localMountOffset.z < 0
    );
    if (sideMatch) resolvedDescriptor = sideMatch;
  }

  if (!resolvedDescriptor || error) {
    return makeUnavailableResult({
      sensorKind: "encoder",
      descriptor: resolvedDescriptor,
      timestampSeconds: simState.timeSeconds,
      reason: error ?? "No wheel encoder installed.",
    });
  }

  if (resolvedDescriptor.availability !== "ready") {
    return makeUnavailableResult({
      sensorKind: "encoder",
      descriptor: resolvedDescriptor,
      timestampSeconds: simState.timeSeconds,
      reason:
        resolvedDescriptor.availabilityReason ??
        `Encoder unavailable (${resolvedDescriptor.availability}).`,
    });
  }

  let resolvedSide: "left" | "right" | "average";
  if (isSideKeyword) {
    resolvedSide = sideOrSensorId;
  } else {
    resolvedSide =
      resolvedDescriptor.localMountOffset.z > 0.01
        ? "left"
        : resolvedDescriptor.localMountOffset.z < -0.01
          ? "right"
          : "average";
  }

  const radians =
    resolvedSide === "left"
      ? accumulator.leftRadians
      : resolvedSide === "right"
        ? accumulator.rightRadians
        : (accumulator.leftRadians + accumulator.rightRadians) * 0.5;
  const omega =
    resolvedSide === "left"
      ? simState.leftWheelAngularVelocityRadPerSec
      : resolvedSide === "right"
        ? simState.rightWheelAngularVelocityRadPerSec
        : (simState.leftWheelAngularVelocityRadPerSec +
            simState.rightWheelAngularVelocityRadPerSec) *
          0.5;
  const linearSpeedMps =
    resolvedSide === "left"
      ? simState.leftWheelLinearSurfaceSpeedMps
      : resolvedSide === "right"
        ? simState.rightWheelLinearSurfaceSpeedMps
        : (simState.leftWheelLinearSurfaceSpeedMps +
            simState.rightWheelLinearSurfaceSpeedMps) *
          0.5;
  const distanceMeters =
    resolvedSide === "left"
      ? accumulator.leftDistanceMeters
      : resolvedSide === "right"
        ? accumulator.rightDistanceMeters
        : (accumulator.leftDistanceMeters + accumulator.rightDistanceMeters) * 0.5;

  const revolutions = radians / TWO_PI;
  const ticks = Math.round(revolutions * DEFAULT_ENCODER_TICKS_PER_REV);

  return {
    ok: true,
    status: "ready",
    sensorId: resolvedDescriptor.sensorId,
    sensorName: resolvedDescriptor.name,
    sensorKind: "encoder",
    timestampSeconds: simState.timeSeconds,
    assumptions: [
      ...resolvedDescriptor.assumptions,
      `Nominal quadrature encoder resolution assumed at ${DEFAULT_ENCODER_TICKS_PER_REV} ticks per wheel revolution driven directly by drivetrain wheel kinematics.`,
    ],
    data: {
      side: resolvedSide,
      ticks,
      revolutions: Number(revolutions.toFixed(4)),
      angularVelocityRadPerSec: Number(omega.toFixed(4)),
      linearSpeedMps: Number(linearSpeedMps.toFixed(4)),
      distanceMeters: Number(distanceMeters.toFixed(4)),
      ticksPerRevolution: DEFAULT_ENCODER_TICKS_PER_REV,
    },
  };
}

export function buildRobotSensorsSnapshot(params: {
  readonly descriptors: readonly SensorDescriptor[];
  readonly robotConfig: SimulationRobotConfig;
  readonly simState: SimulationState;
  readonly arena: ArenaConfig;
  readonly accumulator: EncoderAccumulatorState;
}): RobotSensorsSnapshot {
  const { descriptors, robotConfig, simState, arena, accumulator } = params;
  return {
    installedSensors: descriptors,
    ultrasonic: simulateDistanceSensor({ descriptors, simState, arena }),
    proximity: simulateIrProximitySensor({ descriptors, simState, arena }),
    lineSensor: simulateLineSensor({ descriptors, simState, arena }),
    imu: simulateImuSensor({ descriptors, simState }),
    leftEncoder: simulateEncoderSensor({
      descriptors,
      robotConfig,
      simState,
      accumulator,
      sideOrSensorId: "left",
    }),
    rightEncoder: simulateEncoderSensor({
      descriptors,
      robotConfig,
      simState,
      accumulator,
      sideOrSensorId: "right",
    }),
  };
}
