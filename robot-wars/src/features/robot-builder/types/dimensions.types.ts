/**
 * Canonical dimensional and physical property type architecture for Robot Wars.
 *
 * Establishes explicit geometry semantics, axis orientations, and SI base units:
 * - Length: meters (m)
 * - Mass: kilograms (kg)
 * - Potential difference: volts (V)
 * - Electric current: amperes (A)
 * - Torque: Newton-meters (N·m)
 * - Rotational speed: revolutions per minute (RPM)
 *
 * Canonical Robot Coordinate Frame:
 * - +X = Front / Longitudinal
 * - -X = Rear
 * - +Y = Up / Vertical
 * - -Y = Down
 * - +Z = Left / Lateral
 * - -Z = Right
 */

/**
 * Explicit 3D Cartesian bounding box extents in Three.js world space in meters.
 *
 * Semantics:
 * - [0] (x): Extent along the robot's longitudinal axis (+X Front / -X Rear)
 * - [1] (y): Extent along the robot's vertical axis (+Y Up / -Y Down)
 * - [2] (z): Extent along the robot's lateral axis (+Z Left / -Z Right)
 */
export type CartesianBoundingTuple = readonly [x: number, y: number, z: number];

/**
 * Named Cartesian bounding extents in canonical meters.
 */
export type CartesianBoundingExtents = {
  /** Extent along longitudinal axis (+X Front / -X Rear), in meters */
  readonly x: number;
  /** Extent along vertical axis (+Y Up / -Y Down), in meters */
  readonly y: number;
  /** Extent along lateral axis (+Z Left / -Z Right), in meters */
  readonly z: number;
};

/**
 * Rectangular cuboid geometry for foundations, plates, batteries, and controllers.
 * All dimensions are strictly in canonical meters (m).
 *
 * Spatial alignment semantics:
 * - length: along the robot's longitudinal axis (+X Front / -X Rear)
 * - height: along the robot's vertical axis (+Y Up / -Y Down)
 * - width: along the robot's lateral axis (+Z Left / -Z Right)
 */
export type BoxGeometry = {
  readonly shape: "box";
  /** Extent along the robot's longitudinal axis (+X Front / -X Rear), in meters */
  readonly length: number;
  /** Extent along the robot's vertical axis (+Y Up / -Y Down), in meters */
  readonly height: number;
  /** Extent along the robot's lateral axis (+Z Left / -Z Right), in meters */
  readonly width: number;
};

/**
 * Supported principal rotational / symmetry axes for cylindrical components.
 *
 * - "x": Aligned with robot longitudinal axis (+X / -X).
 *        Used by standard robot drive wheels mounted on the lateral sides,
 *        or longitudinal spinning weapon drums.
 * - "y": Aligned with robot vertical axis (+Y / -Y).
 *        Used by horizontal spinning discs, turntables, or vertical standoffs.
 * - "z": Aligned with robot lateral axis (+Z / -Z).
 *        Used by transverse rollers or lateral weapon bars.
 */
export type CylinderAxis = "x" | "y" | "z";

/**
 * Cylindrical geometry for wheels, shafts, rollers, and motors.
 * All dimensions are strictly in canonical meters (m).
 */
export type CylinderGeometry = {
  readonly shape: "cylinder";
  /** Outer diameter of the cylinder, in meters */
  readonly diameter: number;
  /**
   * Axial width / thickness of the cylinder along its central symmetry axis,
   * in meters.
   */
  readonly axialWidth: number;
  /**
   * Explicit principal orientation of the cylinder's symmetry/rotational axis
   * in local/world robot coordinates ("x" | "y" | "z").
   */
  readonly axis: CylinderAxis;
};

/**
 * Discriminated union of supported canonical component geometries.
 */
export type ComponentGeometry = BoxGeometry | CylinderGeometry;

/**
 * Intrinsic mass specification for a component or assembly.
 * Units: canonical kilograms (kg).
 *
 * Note: Represents scalar mass quantity (kg), distinct from gravitational
 * weight force (N = m * g).
 */
export type ComponentMass = {
  /** Intrinsic mass in canonical kilograms (kg) */
  readonly massKg: number;
};

/**
 * Electrical property specifications in canonical SI units.
 */
export type ElectricalSpecs = {
  /** Nominal DC potential difference in canonical volts (V) */
  readonly nominalVoltageV?: number;
  /** Minimum allowable operating voltage in volts (V) */
  readonly minVoltageV?: number;
  /** Maximum allowable operating voltage in volts (V) */
  readonly maxVoltageV?: number;
  /** Continuous operating current in canonical amperes (A) */
  readonly continuousCurrentA?: number;
  /** Maximum stall / surge current in canonical amperes (A) */
  readonly peakCurrentA?: number;
  /** Stored electrical charge capacity in milliampere-hours (mAh) */
  readonly capacityMah?: number;
};

/**
 * Mechanical and rotational specifications in canonical units.
 */
export type MechanicalSpecs = {
  /** Maximum continuous or stall torque in canonical Newton-meters (N·m) */
  readonly stallTorqueNm?: number;
  /** No-load angular velocity in revolutions per minute (RPM) */
  readonly noLoadRpm?: number;
};
