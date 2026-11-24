/**
 * Canonical data contracts for ground surfaces in Robot Wars simulation.
 *
 * NOTE: These are pure data contracts and interfaces for environmental ground surfaces,
 * friction characteristics, provenance metadata, and validation.
 * Completely decoupled from React, Three.js, DOM, and UI rendering.
 */

/**
 * Origin and verification metadata for a ground surface definition.
 */
export interface GroundSurfaceProvenance {
  /** Information source or basis (e.g. "assumed-simulation-preset", "literature-estimate") */
  readonly source: string;
  /** Whether the surface properties are backed by empirical/datasheet verification */
  readonly verified: boolean;
  /** Engineering caveats, material pairings, or simulation assumptions */
  readonly notes?: string;
}

/**
 * Representation of an environmental ground surface for dynamic simulation.
 */
export interface GroundSurface {
  /** Stable unique identifier for the surface (e.g. "steel", "concrete") */
  readonly id: string;
  /** Human-readable display name */
  readonly name: string;
  /** Detailed physical and contextual description */
  readonly description: string;
  /**
   * Static coefficient of friction (μs) against standard reference tire/wheel material.
   * Must be a non-negative finite number (μs >= 0).
   */
  readonly staticFrictionCoeff: number;
  /**
   * Kinetic / dynamic coefficient of friction (μk) under slip conditions.
   * Must be a non-negative finite number (0 <= μk <= μs).
   */
  readonly kineticFrictionCoeff: number;
  /** Provenance and engineering assumption metadata */
  readonly provenance?: GroundSurfaceProvenance;
}

/**
 * Result of surface validation.
 */
export interface GroundSurfaceValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Resolved static and kinetic friction coefficients for a wheel-surface contact pair.
 */
export interface EffectiveFrictionResult {
  readonly staticFrictionCoeff: number;
  readonly kineticFrictionCoeff: number;
}
