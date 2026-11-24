/**
 * Geometry adapter layer for Robot Wars.
 *
 * Converts canonical geometric specifications (BoxGeometry, CylinderGeometry)
 * into Three.js Cartesian bounding extents [X, Y, Z] in meters.
 *
 * Canonical Robot Coordinate Frame:
 * - +X = Front / Longitudinal (Length)
 * - -X = Rear
 * - +Y = Up / Vertical (Height)
 * - -Y = Down
 * - +Z = Left / Lateral (Width)
 * - -Z = Right
 */

import type {
  CartesianBoundingExtents,
  CartesianBoundingTuple,
  ComponentGeometry,
} from "../types/dimensions.types";

/**
 * Converts canonical component geometry into Cartesian bounding extents [X, Y, Z] in meters.
 *
 * Mapping rules:
 * - BoxGeometry: [length, height, width]
 * - CylinderGeometry:
 *   - axis "x": [axialWidth, diameter, diameter]
 *   - axis "y": [diameter, axialWidth, diameter]
 *   - axis "z": [diameter, diameter, axialWidth]
 *
 * Note: Pure conversion layer. Values are passed through directly without clamping or validation.
 */
export function toBoundingBoxExtents(
  geometry: ComponentGeometry
): CartesianBoundingTuple {
  switch (geometry.shape) {
    case "box":
      return [geometry.length, geometry.height, geometry.width];
    case "cylinder": {
      switch (geometry.axis) {
        case "x":
          return [geometry.axialWidth, geometry.diameter, geometry.diameter];
        case "y":
          return [geometry.diameter, geometry.axialWidth, geometry.diameter];
        case "z":
          return [geometry.diameter, geometry.diameter, geometry.axialWidth];
      }
    }
  }
}

/**
 * Converts a Cartesian bounding tuple [X, Y, Z] into a named CartesianBoundingExtents object.
 */
export function toBoundingExtentsObject(
  extents: CartesianBoundingTuple
): CartesianBoundingExtents {
  return {
    x: extents[0],
    y: extents[1],
    z: extents[2],
  };
}

/**
 * Converts a named CartesianBoundingExtents object into a Cartesian bounding tuple [X, Y, Z].
 */
export function toBoundingTuple(
  extents: CartesianBoundingExtents
): CartesianBoundingTuple {
  return [extents.x, extents.y, extents.z];
}

/**
 * Structural source interface for components with dimensional data.
 * Compatible with RobotPart, catalogue definitions, and test fixtures.
 */
export interface PartDimensionalSource {
  readonly geometry?: ComponentGeometry;
  readonly size: readonly [number, number, number] | [number, number, number];
  readonly wheelDiameter?: number;
  readonly wheelWidth?: number;
}

/**
 * Resolves the 3D Cartesian bounding extents [X, Y, Z] in meters for a component.
 * Reads canonical part.geometry first using toBoundingBoxExtents, falling back to legacy part.size.
 */
export function getPartBoundingExtents(
  part: PartDimensionalSource
): CartesianBoundingTuple {
  if (part.geometry) {
    return toBoundingBoxExtents(part.geometry);
  }
  return [part.size[0], part.size[1], part.size[2]];
}

/**
 * Resolves [length, height, width] box extents in meters for box-modeled components.
 * Prefers canonical box geometry (length, height, width), converts cylinder geometry via
 * toBoundingBoxExtents if present, and falls back to legacy part.size.
 */
export function getPartBoxExtents(
  part: PartDimensionalSource
): [number, number, number] {
  if (part.geometry) {
    if (part.geometry.shape === "box") {
      return [part.geometry.length, part.geometry.height, part.geometry.width];
    }
    const extents = toBoundingBoxExtents(part.geometry);
    return [extents[0], extents[1], extents[2]];
  }
  return [part.size[0], part.size[1], part.size[2]];
}

/**
 * Resolves cylindrical dimensions (radius, diameter, width) in meters.
 * Prefers canonical cylinder geometry (diameter, axialWidth), falling back to legacy
 * wheelDiameter/wheelWidth and part.size.
 */
export function getPartCylinderDimensions(
  part: PartDimensionalSource
): { radius: number; diameter: number; width: number } {
  if (part.geometry?.shape === "cylinder") {
    const diameter = part.geometry.diameter;
    const width = part.geometry.axialWidth;
    return {
      radius: diameter / 2,
      diameter,
      width,
    };
  }
  const diameter = part.wheelDiameter ?? part.size[0];
  const width = part.wheelWidth ?? part.size[1];
  return {
    radius: diameter / 2,
    diameter,
    width,
  };
}

export type WheelDiameterResolutionSource =
  | "explicit-wheel-diameter"
  | "canonical-cylinder"
  | "legacy-size"
  | "none";

export type WheelDiameterFailureReason =
  | "missing-geometry"
  | "invalid-geometry"
  | "unsupported-shape"
  | "non-positive";

export type WheelDimensionResolution = {
  readonly isValid: boolean;
  /** Resolved wheel diameter in canonical meters (0 if invalid) */
  readonly diameterM: number;
  /** Resolved wheel radius in canonical meters (0 if invalid) */
  readonly radiusM: number;
  /** Resolved wheel axial width in canonical meters, if available */
  readonly widthM?: number;
  /** Field or geometry source from which diameter was resolved */
  readonly source: WheelDiameterResolutionSource;
  /** Structured failure reason if invalid */
  readonly failureReason?: WheelDiameterFailureReason;
  /** Human-readable warning or explanation string */
  readonly warning?: string;
};

/**
 * Pure helper that resolves wheel diameter, radius, and width using canonical geometry
 * and legacy fallback rules.
 *
 * Precedence:
 * 1. Explicit `part.wheelDiameter` if finite and strictly positive (> 0).
 * 2. Canonical `CylinderGeometry` (`geometry.diameter` and `geometry.axialWidth`).
 *    - Rejects unsupported geometry shapes (e.g., `BoxGeometry`) as invalid for a wheel.
 * 3. Legacy `part.size[0]` (diameter) and `part.size[1]` (width) if `part.geometry` is undefined.
 */
export function resolveWheelDimensions(
  part: PartDimensionalSource & { readonly id?: string; readonly name?: string }
): WheelDimensionResolution {
  const partName = part.name ?? part.id ?? "Unknown Wheel";

  // 1. Explicit wheelDiameter
  if (
    typeof part.wheelDiameter === "number" &&
    Number.isFinite(part.wheelDiameter) &&
    part.wheelDiameter > 0
  ) {
    const widthM =
      typeof part.wheelWidth === "number" &&
      Number.isFinite(part.wheelWidth) &&
      part.wheelWidth > 0
        ? part.wheelWidth
        : part.geometry?.shape === "cylinder" &&
          Number.isFinite(part.geometry.axialWidth) &&
          part.geometry.axialWidth > 0
        ? part.geometry.axialWidth
        : part.size && Number.isFinite(part.size[1]) && part.size[1] > 0
        ? part.size[1]
        : undefined;

    return {
      isValid: true,
      diameterM: part.wheelDiameter,
      radiusM: part.wheelDiameter / 2,
      widthM,
      source: "explicit-wheel-diameter",
    };
  }

  // 2. Canonical geometry
  if (part.geometry) {
    if (part.geometry.shape === "cylinder") {
      const d = part.geometry.diameter;
      if (typeof d === "number" && Number.isFinite(d) && d > 0) {
        const w = part.geometry.axialWidth;
        const widthM = typeof w === "number" && Number.isFinite(w) && w > 0 ? w : undefined;
        return {
          isValid: true,
          diameterM: d,
          radiusM: d / 2,
          widthM,
          source: "canonical-cylinder",
        };
      }
      return {
        isValid: false,
        diameterM: 0,
        radiusM: 0,
        source: "none",
        failureReason: "invalid-geometry",
        warning: `Component "${partName}" has cylinder geometry with invalid or non-positive diameter (${d}).`,
      };
    }

    // Geometry is not a cylinder (e.g. box) -> unsupported shape for wheel
    return {
      isValid: false,
      diameterM: 0,
      radiusM: 0,
      source: "none",
      failureReason: "unsupported-shape",
      warning: `Component "${partName}" has unsupported geometry shape "${part.geometry.shape}" for a wheel; cannot resolve diameter.`,
    };
  }

  // 3. Legacy size fallback (when geometry is undefined)
  if (part.size && Array.isArray(part.size)) {
    const d = part.size[0];
    if (typeof d === "number" && Number.isFinite(d) && d > 0) {
      const w = part.size[1];
      const widthM = typeof w === "number" && Number.isFinite(w) && w > 0 ? w : undefined;
      return {
        isValid: true,
        diameterM: d,
        radiusM: d / 2,
        widthM,
        source: "legacy-size",
      };
    }

    if (typeof d === "number" && (!Number.isFinite(d) || d <= 0)) {
      return {
        isValid: false,
        diameterM: 0,
        radiusM: 0,
        source: "none",
        failureReason: "non-positive",
        warning: `Component "${partName}" has invalid or non-positive legacy wheel size [${d}].`,
      };
    }
  }

  return {
    isValid: false,
    diameterM: 0,
    radiusM: 0,
    source: "none",
    failureReason: "missing-geometry",
    warning: `Component "${partName}" has missing or invalid wheel geometry.`,
  };
}

/**
 * Resolves wheel diameter in canonical meters, returning 0 if invalid.
 */
export function resolveWheelDiameter(
  part: PartDimensionalSource & { readonly id?: string; readonly name?: string }
): number {
  return resolveWheelDimensions(part).diameterM;
}

/**
 * Resolves wheel radius in canonical meters, returning 0 if invalid.
 */
export function resolveWheelRadius(
  part: PartDimensionalSource & { readonly id?: string; readonly name?: string }
): number {
  return resolveWheelDimensions(part).radiusM;
}

