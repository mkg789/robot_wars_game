/**
 * Pure simulation viewport camera framing and inspection helpers (Phases 4.4 & 4.6).
 *
 * Completely decoupled from Three.js, React Three Fiber, DOM, and physics.
 * Uses canonical X-Z planar arena coordinates:
 * - +X = forward, +Y = up, +Z = left
 * - headingRadians = 0 aligns forward with +X; +headingRadians turns toward +Z
 */

import type { ArenaConfig } from "../types/arena.types";

export interface SimulationCameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly minDistance: number;
  readonly maxDistance: number;
}

export type SimulationCameraMode = "orbit" | "follow";

export type SimulationCameraPreset =
  | "overview"
  | "front"
  | "rear"
  | "left"
  | "right"
  | "top";

export interface RobotInspectionPoseInput {
  readonly xMeters: number;
  readonly zMeters: number;
  readonly headingRadians: number;
}

export interface RobotInspectionFootprintInput {
  readonly lengthM: number;
  readonly widthM: number;
}

const DEFAULT_MIN_INSPECTION_DISTANCE = 0.9;

function computeMaxDistance(arena: ArenaConfig): number {
  const arenaSpan = Math.max(
    4,
    arena.dimensions.lengthM,
    arena.dimensions.widthM
  );
  return Math.max(18, arenaSpan * 2.5);
}

/**
 * Computes the default 3/4 arena overview camera pose from ArenaConfig bounds.
 * Positioned behind -X and slightly offset in +Z so +X robot forward faces into the arena.
 */
export function computeDefaultSimulationCameraPose(
  arena: ArenaConfig
): SimulationCameraPose {
  const arenaSpan = Math.max(
    4,
    arena.dimensions.lengthM,
    arena.dimensions.widthM
  );
  const centerX = (arena.bounds.minX + arena.bounds.maxX) / 2;
  const centerZ = (arena.bounds.minZ + arena.bounds.maxZ) / 2;

  return {
    position: [
      centerX - arenaSpan * 0.62,
      Math.max(4.5, arenaSpan * 0.68),
      centerZ + arenaSpan * 0.45,
    ],
    target: [centerX, 0.25, centerZ],
    minDistance: DEFAULT_MIN_INSPECTION_DISTANCE,
    maxDistance: computeMaxDistance(arena),
  };
}

/**
 * Computes a close-range follow-camera pose centered on the robot's current X-Z position.
 */
export function computeFollowSimulationCameraPose(
  robotPose: { readonly xMeters: number; readonly zMeters: number },
  arena: ArenaConfig
): SimulationCameraPose {
  return {
    position: [
      robotPose.xMeters - 3.8,
      3.4,
      robotPose.zMeters + 2.8,
    ],
    target: [robotPose.xMeters, 0.25, robotPose.zMeters],
    minDistance: DEFAULT_MIN_INSPECTION_DISTANCE,
    maxDistance: computeMaxDistance(arena),
  };
}

/**
 * Computes a preset inspection camera pose relative to the robot's position,
 * heading, and bounding dimensions without mutating physics state.
 */
export function computeInspectionSimulationCameraPose(params: {
  readonly preset: SimulationCameraPreset;
  readonly arena: ArenaConfig;
  readonly robotPose: RobotInspectionPoseInput;
  readonly footprint?: RobotInspectionFootprintInput;
}): SimulationCameraPose {
  const { preset, arena, robotPose, footprint } = params;

  if (preset === "overview") {
    return computeDefaultSimulationCameraPose(arena);
  }

  const lengthM = Math.max(0.8, footprint?.lengthM ?? 1.8);
  const widthM = Math.max(0.8, footprint?.widthM ?? 1.4);
  const robotSpan = Math.max(1.2, lengthM, widthM);

  const rx = Number.isFinite(robotPose.xMeters) ? robotPose.xMeters : 0;
  const rz = Number.isFinite(robotPose.zMeters) ? robotPose.zMeters : 0;
  const heading = Number.isFinite(robotPose.headingRadians)
    ? robotPose.headingRadians
    : 0;

  // Canonical +X forward and +Z left unit vectors matching rotation.y = -headingRadians
  const fwdX = Math.cos(heading);
  const fwdZ = Math.sin(heading);
  const leftX = -Math.sin(heading);
  const leftZ = Math.cos(heading);

  const targetY = 0.22;
  const sideDist = Math.max(2.4, robotSpan * 1.75);
  const sideElevation = Math.max(0.85, robotSpan * 0.52);
  const maxDistance = computeMaxDistance(arena);

  switch (preset) {
    case "front":
      return {
        position: [
          rx + fwdX * sideDist,
          sideElevation,
          rz + fwdZ * sideDist,
        ],
        target: [rx, targetY, rz],
        minDistance: DEFAULT_MIN_INSPECTION_DISTANCE,
        maxDistance,
      };
    case "rear":
      return {
        position: [
          rx - fwdX * sideDist,
          sideElevation,
          rz - fwdZ * sideDist,
        ],
        target: [rx, targetY, rz],
        minDistance: DEFAULT_MIN_INSPECTION_DISTANCE,
        maxDistance,
      };
    case "left":
      return {
        position: [
          rx + leftX * sideDist,
          sideElevation,
          rz + leftZ * sideDist,
        ],
        target: [rx, targetY, rz],
        minDistance: DEFAULT_MIN_INSPECTION_DISTANCE,
        maxDistance,
      };
    case "right":
      return {
        position: [
          rx - leftX * sideDist,
          sideElevation,
          rz - leftZ * sideDist,
        ],
        target: [rx, targetY, rz],
        minDistance: DEFAULT_MIN_INSPECTION_DISTANCE,
        maxDistance,
      };
    case "top": {
      const topHeight = Math.max(2.8, robotSpan * 2.05);
      // Slight rear offset avoids OrbitControls polar singularity while keeping +X forward upward
      return {
        position: [
          rx - fwdX * 0.14,
          topHeight,
          rz - fwdZ * 0.14,
        ],
        target: [rx, targetY, rz],
        minDistance: DEFAULT_MIN_INSPECTION_DISTANCE,
        maxDistance,
      };
    }
  }
}

/**
 * Computes incremental X-Z translation delta for follow-camera tracking without overwriting orbit angles.
 */
export function computeFollowCameraDelta(
  previousTarget: { readonly x: number; readonly z: number },
  currentPose: { readonly xMeters: number; readonly zMeters: number }
): { readonly dx: number; readonly dz: number } {
  if (
    !Number.isFinite(previousTarget.x) ||
    !Number.isFinite(previousTarget.z) ||
    !Number.isFinite(currentPose.xMeters) ||
    !Number.isFinite(currentPose.zMeters)
  ) {
    return { dx: 0, dz: 0 };
  }

  return {
    dx: currentPose.xMeters - previousTarget.x,
    dz: currentPose.zMeters - previousTarget.z,
  };
}
