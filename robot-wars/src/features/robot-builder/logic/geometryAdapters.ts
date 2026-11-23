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
