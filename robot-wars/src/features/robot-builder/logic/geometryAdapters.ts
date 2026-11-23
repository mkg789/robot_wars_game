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
