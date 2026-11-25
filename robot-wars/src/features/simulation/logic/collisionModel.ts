/**
 * Pure Planar Collision Detection Foundation for Robot Wars.
 *
 * Implements:
 * - Robot collision envelope (Oriented Bounding Box in X-Z ground plane).
 * - Broad-phase AABB candidate filtering.
 * - Narrow-phase Separating Axis Theorem (SAT) collision test between OBB and rectangular barriers.
 * - Strict collision normal convention (normal points FROM barrier INTO robot).
 * - Deterministic, pure query functions with stable sorting by barrierId.
 *
 * Coordinate Conventions:
 * - +X = front baseline (longitudinal front)
 * - -X = rear baseline (longitudinal rear)
 * - +Y = vertical height (upward)
 * - +Z = left baseline (lateral left)
 * - -Z = right baseline (lateral right)
 * - Heading θ = 0 points along +X, positive angles rotate CCW toward +Z.
 *
 * NOTE: Strictly collision detection only. Does NOT implement collision response,
 * impulses, forces, velocity changes, or position corrections.
 * Completely decoupled from React, Three.js, DOM, and UI rendering.
 */

import type {
  ArenaBarrier,
  ArenaBounds2D,
  ArenaConfig,
} from "../types/arena.types";
import type {
  ArenaCollisionQueryResult,
  CollisionContact,
  CollisionDetectionOptions,
  ObbVertices2D,
  RobotCollisionEnvelope,
  Vector2D,
} from "../types/collision.types";
import type { SimulationRobotConfig } from "../types/simulation.types";
import { getBarrierBounds } from "./arenaModel";

/**
 * Default numerical tolerance in meters for separating axis overlap evaluations.
 */
export const DEFAULT_COLLISION_TOLERANCE_M = 1e-7;

/**
 * Calculates the four corner vertices of an oriented bounding box (OBB) in the X-Z ground plane.
 *
 * Local orientation:
 * - Length is along local X (front/rear).
 * - Width is along local Z (left/right).
 * - At θ = 0, local X aligns with world +X and local Z aligns with world +Z.
 */
export function computeObbVertices(
  center: Vector2D,
  lengthM: number,
  widthM: number,
  headingRadians: number
): ObbVertices2D {
  if (
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.z) ||
    !Number.isFinite(lengthM) ||
    !Number.isFinite(widthM) ||
    !Number.isFinite(headingRadians)
  ) {
    throw new Error(
      "computeObbVertices: center, length, width, and heading must all be finite numbers."
    );
  }
  if (lengthM <= 0 || widthM <= 0) {
    throw new Error(
      `computeObbVertices: length (${lengthM}) and width (${widthM}) must be strictly positive.`
    );
  }

  const halfL = lengthM / 2;
  const halfW = widthM / 2;

  // Longitudinal forward unit vector: u_fwd = (cos θ, sin θ) in (X, Z)
  const cos = Math.cos(headingRadians);
  const sin = Math.sin(headingRadians);

  // Forward vector (+X local)
  const fwdX = halfL * cos;
  const fwdZ = halfL * sin;

  // Left lateral vector (+Z local, turned 90° CCW: (-sin θ, cos θ))
  const leftX = -halfW * sin;
  const leftZ = halfW * cos;

  return {
    // Front-Left (+fwd, +left)
    frontLeft: {
      x: center.x + fwdX + leftX,
      z: center.z + fwdZ + leftZ,
    },
    // Front-Right (+fwd, -left)
    frontRight: {
      x: center.x + fwdX - leftX,
      z: center.z + fwdZ - leftZ,
    },
    // Rear-Right (-fwd, -left)
    rearRight: {
      x: center.x - fwdX - leftX,
      z: center.z - fwdZ - leftZ,
    },
    // Rear-Left (-fwd, +left)
    rearLeft: {
      x: center.x - fwdX + leftX,
      z: center.z - fwdZ + leftZ,
    },
  };
}

/**
 * Derives the tight axis-aligned bounding box (AABB) enclosing the four OBB corner vertices.
 */
export function computeAabbFromVertices(vertices: ObbVertices2D): ArenaBounds2D {
  const xs = [
    vertices.frontLeft.x,
    vertices.frontRight.x,
    vertices.rearRight.x,
    vertices.rearLeft.x,
  ];
  const zs = [
    vertices.frontLeft.z,
    vertices.frontRight.z,
    vertices.rearRight.z,
    vertices.rearLeft.z,
  ];

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/**
 * Factory creating an immutable RobotCollisionEnvelope from planar pose and dimensions.
 */
export function createRobotCollisionEnvelope(
  pose: { readonly x: number; readonly z: number; readonly headingRadians: number },
  dimensions: { readonly lengthM: number; readonly widthM: number },
  entityId?: string
): RobotCollisionEnvelope {
  const center: Vector2D = { x: pose.x, z: pose.z };
  const vertices = computeObbVertices(
    center,
    dimensions.lengthM,
    dimensions.widthM,
    pose.headingRadians
  );
  const aabb = computeAabbFromVertices(vertices);

  return {
    entityId,
    position: center,
    headingRadians: pose.headingRadians,
    lengthM: dimensions.lengthM,
    widthM: dimensions.widthM,
    vertices,
    aabb,
  };
}

/**
 * Derives robot planar footprint dimensions (length and width in meters) from a compiled SimulationRobotConfig.
 *
 * Derivation Rules:
 * - Width (Z): Derived from trackWidthM (center-to-center span) plus the outer wheel tire width.
 * - Length (X):
 *   - For 4WD (wheelbaseM is valid and positive): wheelbaseM plus the outer wheel rolling diameter.
 *   - For 2WD (wheelbaseM is null): Driven wheels reside on a single axle; longitudinal length is estimated
 *     via standard chassis aspect ratio heuristic (max of 1.5x wheel diameter or 1.2x track width).
 */
export function deriveRobotFootprintDimensions(config: SimulationRobotConfig): {
  readonly lengthM: number;
  readonly widthM: number;
  readonly source: "drivetrain-geometry" | "fallback-heuristic";
} {
  if (!config || !Number.isFinite(config.trackWidthM) || config.trackWidthM <= 0) {
    throw new Error(
      "deriveRobotFootprintDimensions: config must have a positive finite trackWidthM."
    );
  }

  // Determine wheel dimensions from config, falling back to nominal values if omitted
  const validWidths = config.wheels
    ?.map((w) => w.widthM)
    .filter((w): w is number => typeof w === "number" && Number.isFinite(w) && w > 0);
  const maxWheelWidth =
    validWidths && validWidths.length > 0 ? Math.max(...validWidths) : 0.05;

  const validDiameters = config.wheels
    ?.map((w) => w.diameterM)
    .filter((d): d is number => typeof d === "number" && Number.isFinite(d) && d > 0);
  const maxWheelDiameter =
    validDiameters && validDiameters.length > 0 ? Math.max(...validDiameters) : 0.1;

  const widthM = config.trackWidthM + maxWheelWidth;

  if (
    config.wheelbaseM !== null &&
    Number.isFinite(config.wheelbaseM) &&
    config.wheelbaseM > 0
  ) {
    const lengthM = config.wheelbaseM + maxWheelDiameter;
    return {
      lengthM,
      widthM,
      source: "drivetrain-geometry",
    };
  }

  // Single-axle 2WD fallback: chassis extends beyond single driven axle
  const lengthM = Math.max(maxWheelDiameter * 1.5, config.trackWidthM * 1.2);
  return {
    lengthM,
    widthM,
    source: "fallback-heuristic",
  };
}

/**
 * Derives a full RobotCollisionEnvelope directly from a SimulationRobotConfig and current pose.
 */
export function deriveRobotCollisionEnvelope(
  config: SimulationRobotConfig,
  pose: { readonly x: number; readonly z: number; readonly headingRadians: number },
  overrideDimensions?: { readonly lengthM?: number; readonly widthM?: number },
  entityId?: string
): RobotCollisionEnvelope {
  const derived = deriveRobotFootprintDimensions(config);

  const lengthM = overrideDimensions?.lengthM ?? derived.lengthM;
  const widthM = overrideDimensions?.widthM ?? derived.widthM;

  return createRobotCollisionEnvelope(pose, { lengthM, widthM }, entityId);
}

/**
 * Broad-Phase check: Determines if two 2D axis-aligned bounding boxes overlap within numerical tolerance.
 */
export function checkAabbOverlap(
  a: ArenaBounds2D,
  b: ArenaBounds2D,
  toleranceM = DEFAULT_COLLISION_TOLERANCE_M
): boolean {
  return (
    a.minX <= b.maxX + toleranceM &&
    a.maxX >= b.minX - toleranceM &&
    a.minZ <= b.maxZ + toleranceM &&
    a.maxZ >= b.minZ - toleranceM
  );
}

/**
 * Broad-Phase candidate filter:
 * Evaluates barrier bounding boxes against the robot's AABB to filter out non-colliding barriers in O(N).
 */
export function filterBroadPhaseCandidates(
  robotAabb: ArenaBounds2D,
  barriers: readonly ArenaBarrier[],
  toleranceM = DEFAULT_COLLISION_TOLERANCE_M
): readonly ArenaBarrier[] {
  return barriers.filter((barrier) => {
    const barrierBounds = getBarrierBounds(barrier);
    return checkAabbOverlap(robotAabb, barrierBounds, toleranceM);
  });
}

/**
 * Narrow-Phase Collision Test:
 * Evaluates geometric overlap between a robot's Oriented Bounding Box (OBB) and an axis-aligned rectangular barrier
 * using the Separating Axis Theorem (SAT).
 *
 * Algorithm:
 * - Tests 4 candidate separating axes:
 *   1. Barrier normal X: (1, 0)
 *   2. Barrier normal Z: (0, 1)
 *   3. Robot longitudinal axis: u_fwd = (cos θ, sin θ)
 *   4. Robot lateral axis: u_left = (-sin θ, cos θ)
 * - If overlap along any axis is negative, shapes are separated (no collision).
 * - If all 4 axes overlap, the axis with the minimum overlap is the Minimum Translation Vector (MTV).
 * - Collision normal is strictly oriented to point FROM the barrier INTO the robot.
 *
 * Returns a CollisionContact object if collision is detected, or null if separated.
 */
export function testObbAabbCollision(
  obb: RobotCollisionEnvelope,
  barrier: ArenaBarrier,
  toleranceM = DEFAULT_COLLISION_TOLERANCE_M
): CollisionContact | null {
  const halfL = obb.lengthM / 2;
  const halfW = obb.widthM / 2;

  const cos = Math.cos(obb.headingRadians);
  const sin = Math.sin(obb.headingRadians);

  // Robot local axes
  const uFwd: Vector2D = { x: cos, z: sin };
  const uLeft: Vector2D = { x: -sin, z: cos };

  // Barrier half-extents
  const halfBx = barrier.sizeX / 2;
  const halfBz = barrier.sizeZ / 2;

  // Center-to-center offset vector from barrier to OBB
  const dx = obb.position.x - barrier.position.x;
  const dz = obb.position.z - barrier.position.z;

  // Candidate separating axes:
  // [axisX, axisZ]
  const axes: readonly [number, number][] = [
    [1, 0], // Axis 1: Barrier X
    [0, 1], // Axis 2: Barrier Z
    [uFwd.x, uFwd.z], // Axis 3: Robot Longitudinal
    [uLeft.x, uLeft.z], // Axis 4: Robot Lateral
  ];

  let minOverlap = Number.POSITIVE_INFINITY;
  let bestAxis: Vector2D = { x: 1, z: 0 };

  for (const [ax, az] of axes) {
    // Project OBB half-extents onto axis: r_obb = hL * |a · uFwd| + hW * |a · uLeft|
    const projFwd = Math.abs(ax * uFwd.x + az * uFwd.z);
    const projLeft = Math.abs(ax * uLeft.x + az * uLeft.z);
    const rObb = halfL * projFwd + halfW * projLeft;

    // Project Barrier half-extents onto axis: r_barrier = hBx * |a_x| + hBz * |a_z|
    const rBarrier = halfBx * Math.abs(ax) + halfBz * Math.abs(az);

    // Distance between centers projected onto axis
    const dist = Math.abs(dx * ax + dz * az);

    // Overlap along axis
    const overlap = rObb + rBarrier - dist;

    // If overlap is negative beyond tolerance, shapes are separated
    if (overlap < -toleranceM) {
      return null;
    }

    if (overlap < minOverlap) {
      minOverlap = overlap;
      bestAxis = { x: ax, z: az };
    }
  }

  // Ensure normal points strictly FROM barrier INTO robot: D · normal >= 0
  const dotD = dx * bestAxis.x + dz * bestAxis.z;
  let normalX = bestAxis.x;
  let normalZ = bestAxis.z;

  if (dotD < 0) {
    normalX = -normalX;
    normalZ = -normalZ;
  } else if (Math.abs(dotD) < 1e-12) {
    // Exact center alignment: default normal to push along +X or +Z
    normalX = bestAxis.x;
    normalZ = bestAxis.z;
  }

  // Normalize normal vector
  const normalLen = Math.hypot(normalX, normalZ);
  const normal: Vector2D =
    normalLen > 1e-12
      ? { x: normalX / normalLen, z: normalZ / normalLen }
      : { x: 1, z: 0 };

  const penetrationDepth = Math.max(0, minOverlap);

  // Representative contact point:
  // Find the OBB corner vertex or edge penetrating deepest into the barrier (most negative dot with normal)
  const vertices = [
    obb.vertices.frontLeft,
    obb.vertices.frontRight,
    obb.vertices.rearRight,
    obb.vertices.rearLeft,
  ];

  let minProj = Number.POSITIVE_INFINITY;
  for (const v of vertices) {
    const proj = v.x * normal.x + v.z * normal.z;
    if (proj < minProj) {
      minProj = proj;
    }
  }

  // Collect all vertices tied at minimum normal projection (2 vertices for a face-on edge contact)
  const tiedVertices = vertices.filter(
    (v) => v.x * normal.x + v.z * normal.z <= minProj + 1e-6
  );

  let contactPoint: Vector2D;
  if (tiedVertices.length <= 1) {
    const deepestVertex = tiedVertices[0] ?? vertices[0];
    contactPoint = {
      x: deepestVertex.x + (penetrationDepth / 2) * normal.x,
      z: deepestVertex.z + (penetrationDepth / 2) * normal.z,
    };
  } else {
    // Tangent unit vector perpendicular to normal
    const tx = -normal.z;
    const tz = normal.x;

    let obbTMin = Number.POSITIVE_INFINITY;
    let obbTMax = Number.NEGATIVE_INFINITY;
    for (const v of tiedVertices) {
      const projT = v.x * tx + v.z * tz;
      if (projT < obbTMin) obbTMin = projT;
      if (projT > obbTMax) obbTMax = projT;
    }

    // Clip incident OBB face against barrier tangent span so partial face overlaps preserve torque arm
    const barrierCenterT = barrier.position.x * tx + barrier.position.z * tz;
    const barrierHalfT = halfBx * Math.abs(tx) + halfBz * Math.abs(tz);
    const clipMin = Math.max(obbTMin, barrierCenterT - barrierHalfT);
    const clipMax = Math.min(obbTMax, barrierCenterT + barrierHalfT);

    const contactT =
      clipMin <= clipMax + 1e-9
        ? 0.5 * (clipMin + clipMax)
        : 0.5 * (obbTMin + obbTMax);
    const contactN = minProj + penetrationDepth / 2;

    contactPoint = {
      x: contactN * normal.x + contactT * tx,
      z: contactN * normal.z + contactT * tz,
    };
  }

  const classification = barrier.isPerimeter
    ? "perimeter-wall"
    : "interior-barrier";

  return {
    barrierId: barrier.id,
    barrierName: barrier.name,
    classification,
    normal,
    penetrationDepth,
    contactPoint,
  };
}

/**
 * Performs a complete, deterministic planar collision query for a robot against an arena.
 *
 * Query Pipeline:
 * 1. Collects perimeter walls and interior barriers based on query options.
 * 2. Executes broad-phase AABB candidate filtering to cull disjoint geometry in O(N).
 * 3. Executes narrow-phase Separating Axis Theorem (SAT) collision tests on candidate barriers.
 * 4. Deterministically sorts detected contacts by barrierId.
 *
 * NOTE: Pure detection query. Does not modify robot pose, velocity, or arena state.
 */
export function detectArenaCollisions(
  envelope: RobotCollisionEnvelope,
  arena: ArenaConfig,
  options?: CollisionDetectionOptions
): ArenaCollisionQueryResult {
  if (!envelope || !arena) {
    return {
      hasCollision: false,
      collisionCount: 0,
      collisions: [],
      candidateBarrierIds: [],
    };
  }

  const toleranceM = options?.toleranceM ?? DEFAULT_COLLISION_TOLERANCE_M;
  const includePerimeter = options?.includePerimeterWalls !== false;
  const includeInterior = options?.includeInteriorBarriers !== false;

  const targetBarriers: ArenaBarrier[] = [];

  if (includePerimeter && arena.boundary?.perimeterWalls) {
    targetBarriers.push(...arena.boundary.perimeterWalls);
  }
  if (includeInterior && arena.barriers) {
    targetBarriers.push(...arena.barriers);
  }

  if (targetBarriers.length === 0) {
    return {
      hasCollision: false,
      collisionCount: 0,
      collisions: [],
      candidateBarrierIds: [],
    };
  }

  // 1. Broad-phase AABB candidate filtering
  const candidates = filterBroadPhaseCandidates(
    envelope.aabb,
    targetBarriers,
    toleranceM
  );
  const candidateBarrierIds = candidates.map((b) => b.id);

  if (candidates.length === 0) {
    return {
      hasCollision: false,
      collisionCount: 0,
      collisions: [],
      candidateBarrierIds: [],
    };
  }

  // 2. Narrow-phase SAT collision testing
  const collisions: CollisionContact[] = [];

  for (const barrier of candidates) {
    const contact = testObbAabbCollision(envelope, barrier, toleranceM);
    if (contact !== null) {
      collisions.push(contact);
    }
  }

  // 3. Deterministic sorting by barrierId
  collisions.sort((a, b) => a.barrierId.localeCompare(b.barrierId));

  return {
    hasCollision: collisions.length > 0,
    collisionCount: collisions.length,
    collisions,
    candidateBarrierIds,
  };
}
