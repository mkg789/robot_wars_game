/**
 * Canonical data contracts for Arena Geometry & Spatial Surface Zones in Robot Wars.
 *
 * NOTE: These are pure data contracts and interfaces for arena boundaries,
 * geometric barriers, and spatial surface zones in the planar X-Z world frame.
 * Completely decoupled from React, Three.js, DOM, and UI rendering.
 *
 * Physical Coordinate Conventions:
 * - +X = front baseline (longitudinal front)
 * - -X = rear baseline (longitudinal rear)
 * - +Y = vertical height (upward)
 * - +Z = left baseline (lateral left)
 * - -Z = right baseline (lateral right)
 */

import type { GroundSurface } from "./surface.types";

/**
 * 2D Axis-aligned bounding box extents in the arena ground plane (meters).
 */
export interface ArenaBounds2D {
  /** Minimum longitudinal position in meters (-X rear extent) */
  readonly minX: number;
  /** Maximum longitudinal position in meters (+X front extent) */
  readonly maxX: number;
  /** Minimum lateral position in meters (-Z right extent) */
  readonly minZ: number;
  /** Maximum lateral position in meters (+Z left extent) */
  readonly maxZ: number;
}

/**
 * Primary physical dimensions of an arena in canonical SI units (meters).
 */
export interface ArenaDimensions {
  /** Longitudinal length along the X axis in meters (length = maxX - minX) */
  readonly lengthM: number;
  /** Lateral width along the Z axis in meters (width = maxZ - minZ) */
  readonly widthM: number;
  /** Optional vertical clearance height in meters, if defined */
  readonly heightM?: number;
}

/**
 * Supported barrier geometry types for extensible geometry representation.
 */
export type BarrierGeometryType = "rectangle";

/**
 * Common metadata attributes for any arena barrier.
 */
export interface BaseArenaBarrier {
  /** Stable unique identifier for the barrier */
  readonly id: string;
  /** Human-readable display name */
  readonly name?: string;
  /** Contextual or descriptive notes */
  readonly description?: string;
  /** Whether this barrier represents a perimeter boundary wall */
  readonly isPerimeter?: boolean;
}

/**
 * Axis-aligned rectangular geometric barrier defined in the X-Z ground plane.
 */
export interface RectangularArenaBarrier extends BaseArenaBarrier {
  readonly geometryType: "rectangle";
  /** Center position in the X-Z plane (meters) */
  readonly position: {
    readonly x: number;
    readonly z: number;
  };
  /** Longitudinal extent along X axis in meters */
  readonly sizeX: number;
  /** Lateral extent along Z axis in meters */
  readonly sizeZ: number;
  /** Barrier height above ground plane in meters */
  readonly heightM?: number;
  /** Yaw rotation in radians (0 = axis-aligned) */
  readonly rotationRadians?: number;
}

/**
 * Extensible union of arena barrier geometry types.
 */
export type ArenaBarrier = RectangularArenaBarrier;

/**
 * Perimeter boundary configuration defining the perimeter enclosure.
 */
export interface ArenaBoundaryConfig {
  /** Wall thickness in meters */
  readonly wallThicknessM?: number;
  /** Wall height in meters */
  readonly wallHeightM?: number;
  /** Geometric barrier representations of the perimeter walls */
  readonly perimeterWalls: readonly ArenaBarrier[];
}

/**
 * Supported geometric shapes for spatial surface zones.
 */
export type SurfaceZoneShape = "rectangle";

/**
 * Rectangular spatial surface zone in the X-Z ground plane.
 */
export interface RectangularSurfaceZone {
  /** Stable unique identifier for the surface zone */
  readonly id: string;
  /** Human-readable display name */
  readonly name?: string;
  /** Contextual or descriptive notes */
  readonly description?: string;
  readonly shape: "rectangle";
  /** Bounding rectangle in the X-Z plane */
  readonly bounds: ArenaBounds2D;
  /**
   * Assigned ground surface. Either a preset ID string (e.g. "low-grip", "concrete")
   * or a full GroundSurface object.
   */
  readonly surface: GroundSurface | string;
  /**
   * Overlap resolution priority. Higher numbers take precedence over lower numbers.
   * Default: 0.
   */
  readonly priority?: number;
}

/**
 * Extensible union of spatial surface zones.
 */
export type ArenaSurfaceZone = RectangularSurfaceZone;

/**
 * Origin and specification provenance for an arena configuration.
 */
export interface ArenaProvenance {
  /** Competition league, standard, or user specification */
  readonly standard?: string;
  /** Source or basis of geometry definitions */
  readonly source: string;
  /** Whether the dimensions match an official competition arena spec */
  readonly verified: boolean;
  /** Caveats or engineering notes */
  readonly notes?: string;
}

/**
 * Canonical configuration of a robot arena ready for spatial queries and simulation.
 */
export interface ArenaConfig {
  /** Stable unique identifier */
  readonly id: string;
  /** Human-readable display name */
  readonly name: string;
  /** Contextual or descriptive notes */
  readonly description?: string;
  /** Dimensions in canonical meters */
  readonly dimensions: ArenaDimensions;
  /** 2D rectangular bounds in the X-Z ground plane */
  readonly bounds: ArenaBounds2D;
  /** Perimeter boundary configuration (walls and enclosure data) */
  readonly boundary: ArenaBoundaryConfig;
  /** Interior obstacles and localized geometric barriers */
  readonly barriers: readonly ArenaBarrier[];
  /** Spatial surface zones with friction properties */
  readonly surfaceZones: readonly ArenaSurfaceZone[];
  /**
   * Fallback surface for areas not covered by any spatial surface zone.
   * Defaults to DEFAULT_GROUND_SURFACE (standard arena steel floor).
   */
  readonly fallbackSurface?: GroundSurface | string;
  /** Provenance and specification metadata */
  readonly provenance?: ArenaProvenance;
}

/**
 * Validation diagnostics for an arena barrier.
 */
export interface BarrierValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validation diagnostics for a spatial surface zone.
 */
export interface SurfaceZoneValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validation diagnostics for an entire arena configuration.
 */
export interface ArenaValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}
