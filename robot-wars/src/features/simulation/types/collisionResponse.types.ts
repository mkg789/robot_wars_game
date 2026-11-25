/**
 * Canonical data contracts for Planar Collision Response & Contact Resolution in Robot Wars.
 *
 * NOTE: Pure data contracts for impulse-based planar rigid-body collision response,
 * Coulomb-style barrier contact friction, positional penetration correction, and diagnostics.
 * Completely decoupled from React, Three.js, DOM, and UI rendering.
 *
 * Coordinate Conventions:
 * - +X = front baseline (longitudinal front)
 * - -X = rear baseline (longitudinal rear)
 * - +Y = vertical height (upward)
 * - +Z = left baseline (lateral left)
 * - -Z = right baseline (lateral right)
 * - Heading θ = 0 points along +X; positive yaw rate turns CCW toward +Z.
 * - Collision normal points FROM the static barrier INTO the robot.
 */

import type { Vector2D } from "./collision.types";
import type { SimulationAssumption, SimulationState } from "./simulation.types";

/**
 * Configurable parameters for deterministic planar collision response and contact resolution.
 */
export interface CollisionResponseOptions {
  /**
   * Coefficient of restitution (bounce) in [0, 1].
   * 0 = perfectly inelastic (no bounce); 1 = perfectly elastic.
   * Default assumption: 0.2 (conservative damped metallic/polymer chassis impact).
   */
  readonly restitution?: number;

  /**
   * Coulomb-style tangential friction coefficient at barrier contact (>= 0).
   * Separate from wheel-to-ground surface friction (Phase 4.1.1).
   * Default assumption: 0.3.
   */
  readonly contactFrictionCoeff?: number;

  /**
   * Penetration tolerance (slop) in meters below which positional correction is skipped (>= 0).
   * Default: 0.001 m (1 mm).
   */
  readonly penetrationSlopM?: number;

  /**
   * Fraction of excess penetration corrected per step in [0, 1].
   * Default: 0.8.
   */
  readonly penetrationCorrectionFraction?: number;

  /**
   * Maximum positional correction displacement magnitude in meters per step (>= 0).
   * Default: 0.1 m.
   */
  readonly maxPenetrationCorrectionM?: number;

  /**
   * Bounded number of sequential-impulse solver iterations for multi-contact resolution (integer in [1, 64]).
   * Default: 4.
   */
  readonly solverIterations?: number;

  /**
   * Minimum approaching normal speed (m/s) required to apply restitution (>= 0).
   * Below this threshold, effective restitution is 0 to prevent micro-bounce chatter on sustained contact.
   * Default: 0.2 m/s.
   */
  readonly restitutionVelocityThresholdMps?: number;
}

/**
 * Validated, fully resolved collision response configuration with explicit provenance assumptions.
 */
export interface ResolvedCollisionResponseConfig {
  readonly restitution: number;
  readonly contactFrictionCoeff: number;
  readonly penetrationSlopM: number;
  readonly penetrationCorrectionFraction: number;
  readonly maxPenetrationCorrectionM: number;
  readonly solverIterations: number;
  readonly restitutionVelocityThresholdMps: number;
  readonly assumptions: readonly SimulationAssumption[];
}

/**
 * Validation diagnostics for CollisionResponseOptions.
 */
export interface CollisionResponseValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Per-contact impulse and geometric resolution diagnostic record.
 */
export interface ContactResolutionDiagnostic {
  readonly barrierId: string;
  readonly normal: Vector2D;
  readonly contactPoint: Vector2D;
  readonly penetrationDepthM: number;
  readonly initialNormalVelocityMps: number;
  readonly initialTangentialVelocityMps: number;
  readonly finalNormalVelocityMps: number;
  readonly finalTangentialVelocityMps: number;
  readonly effectiveMassNormalKg: number;
  readonly effectiveMassTangentKg: number;
  readonly normalImpulseNs: number;
  readonly tangentialImpulseNs: number;
  readonly angularImpulseNms: number;
  readonly wasApproaching: boolean;
  readonly wasFrictionSaturated: boolean;
}

/**
 * Complete deterministic result returned by resolveArenaCollisions.
 */
export interface CollisionResponseResult {
  readonly state: SimulationState;
  readonly hasCollisions: boolean;
  readonly contactCount: number;
  readonly solverIterationsExecuted: number;
  readonly totalNormalImpulseNs: number;
  readonly totalTangentialImpulseNs: number;
  readonly positionalCorrectionWorldM: Vector2D;
  readonly kineticEnergyBeforeJ: number;
  readonly kineticEnergyAfterJ: number;
  readonly contacts: readonly ContactResolutionDiagnostic[];
  readonly resolvedConfig: ResolvedCollisionResponseConfig;
}
