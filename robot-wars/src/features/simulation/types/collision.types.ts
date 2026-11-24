/**
 * Canonical data contracts for Planar Collision Detection in Robot Wars.
 *
 * NOTE: These are pure data contracts for 2D robot collision envelopes,
 * oriented bounding boxes (OBB), broad-phase bounding boxes (AABB),
 * narrow-phase SAT results, and collision query diagnostics.
 * Completely decoupled from collision response, forces, impulses, React, Three.js, and DOM.
 *
 * Coordinate Conventions:
 * - +X = front baseline (longitudinal front)
 * - -X = rear baseline (longitudinal rear)
 * - +Y = vertical height (upward)
 * - +Z = left baseline (lateral left)
 * - -Z = right baseline (lateral right)
 */

import type { ArenaBounds2D } from "./arena.types";

/**
 * 2D vector in the arena ground plane (meters).
 */
export interface Vector2D {
  readonly x: number;
  readonly z: number;
}

/**
 * Four corner vertices of an oriented bounding box in arena world space (meters).
 */
export interface ObbVertices2D {
  /** Front-Left corner (+X, +Z in local frame) */
  readonly frontLeft: Vector2D;
  /** Front-Right corner (+X, -Z in local frame) */
  readonly frontRight: Vector2D;
  /** Rear-Right corner (-X, -Z in local frame) */
  readonly rearRight: Vector2D;
  /** Rear-Left corner (-X, +Z in local frame) */
  readonly rearLeft: Vector2D;
}

/**
 * Planar Oriented Bounding Box (OBB) representing a robot's 2D collision footprint.
 */
export interface RobotCollisionEnvelope {
  /** Robot or entity identity */
  readonly entityId?: string;
  /** Center position in the arena X-Z ground plane (meters) */
  readonly position: Vector2D;
  /** Heading angle in radians (θ = 0 points along +X, positive turns toward +Z) */
  readonly headingRadians: number;
  /** Longitudinal extent (length along robot X axis) in meters */
  readonly lengthM: number;
  /** Lateral extent (width along robot Z axis) in meters */
  readonly widthM: number;
  /** Four world-space corner vertices derived from position, heading, and dimensions */
  readonly vertices: ObbVertices2D;
  /** Axis-aligned bounding box bounding the rotated footprint */
  readonly aabb: ArenaBounds2D;
}

/**
 * Collision classification distinguishing perimeter walls from interior obstacles.
 */
export type CollisionClassification = "perimeter-wall" | "interior-barrier";

/**
 * Detailed contact information for an overlap between a robot and a barrier.
 */
export interface CollisionContact {
  /** Barrier identity */
  readonly barrierId: string;
  /** Barrier display name if available */
  readonly barrierName?: string;
  /** Classification of the collided barrier */
  readonly classification: CollisionClassification;
  /**
   * Collision normal unit vector pointing FROM the barrier INTO the robot
   * (the separating direction required to resolve penetration).
   */
  readonly normal: Vector2D;
  /**
   * Scalar penetration depth in canonical meters (depth >= 0).
   */
  readonly penetrationDepth: number;
  /**
   * Representative contact point in arena world coordinates (meters).
   */
  readonly contactPoint: Vector2D;
}

/**
 * Configurable options for an arena collision detection query.
 */
export interface CollisionDetectionOptions {
  /**
   * Numerical tolerance in meters for separating axis overlap checks (default: 1e-7).
   */
  readonly toleranceM?: number;
  /**
   * Whether to test perimeter walls (default: true).
   */
  readonly includePerimeterWalls?: boolean;
  /**
   * Whether to test interior barriers (default: true).
   */
  readonly includeInteriorBarriers?: boolean;
}

/**
 * Comprehensive result of an arena collision detection query.
 */
export interface ArenaCollisionQueryResult {
  /** Whether the robot is currently colliding with any barrier */
  readonly hasCollision: boolean;
  /** Total number of intersecting barriers detected */
  readonly collisionCount: number;
  /**
   * Array of individual collision contacts, sorted deterministically by barrierId.
   */
  readonly collisions: readonly CollisionContact[];
  /** Broad-phase candidate barrier IDs evaluated by narrow-phase */
  readonly candidateBarrierIds: readonly string[];
}
