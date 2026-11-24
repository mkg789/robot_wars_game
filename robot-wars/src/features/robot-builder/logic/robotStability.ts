/**
 * Pure analytical calculation engine for robot center of mass, wheel load distribution,
 * and static stability evaluation.
 *
 * NOTE: This is an analytical engineering evaluation module, NOT a dynamic physics simulation.
 * All calculations are deterministic, zero-dependency, and isolated from React, Three.js,
 * Zustand mutations, and viewport lifecycles.
 */

import type {
  DrivetrainConfiguration,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";
import { resolveWheelDimensions } from "./geometryAdapters";
import { resolveComponentMass } from "./massResolvers";
import { STANDARD_GRAVITY_MPS2 } from "./robotKinematics";

export type CalculationValidity = "valid" | "marginal" | "invalid" | "unsupported";
export type StabilityStatus = "stable" | "marginal" | "unstable" | "unsupported";

export type CenterOfMass = {
  /** Center of mass longitudinal position in canonical meters (+X = front, -X = rear) */
  x: number;
  /** Center of mass vertical position in canonical meters (+Y = up) */
  y: number;
  /** Center of mass lateral position in canonical meters (+Z = left, -Z = right) */
  z: number;
  /** Vertical height of CoM above the calculated ground datum in canonical meters */
  heightAboveGroundM: number;
  /** Calculated ground datum reference in canonical meters */
  groundDatumY: number;
  /** Total robot assembly mass in canonical kilograms */
  totalMassKg: number;
  /** Assessment of calculation validity based on mass inputs */
  validity: CalculationValidity;
  /** Explicit caveats, assumptions, or warnings */
  warnings: string[];
};

export type WheelMountLocation =
  | "front-left"
  | "front-right"
  | "rear-left"
  | "rear-right"
  | "left"
  | "right"
  | "skid"
  | "other";

export type PerWheelLoad = {
  partId: string;
  name: string;
  position: [number, number, number];
  location: WheelMountLocation;
  isDriven: boolean;
  /** Normal ground reaction force on this wheel in Newtons (N) */
  normalForceN: number;
  /** Equivalent mass supported by this wheel in kilograms (kg) */
  massEquivalentKg: number;
  /** Fraction of total robot weight supported by this wheel (0.0 to 1.0) */
  loadFraction: number;
};

export type WheelLoadDistribution = {
  totalMassKg: number;
  totalNormalForceN: number;
  /** Total normal force acting on driven (powered) wheels in Newtons (N) */
  drivenNormalForceN: number;
  /** Equivalent mass supported by driven wheels in kilograms (kg) */
  drivenMassEquivalentKg: number;
  /** Fraction of total robot weight supported by driven wheels (0.0 to 1.0) */
  drivenLoadFraction: number;
  /** Individual wheel normal loads and mass fractions */
  perWheelLoads: PerWheelLoad[];
  /** Combined normal force on front axle/wheels in Newtons (N) */
  frontLoadN?: number;
  /** Combined normal force on rear axle/wheels in Newtons (N) */
  rearLoadN?: number;
  /** Combined normal force on left side wheels in Newtons (N) */
  leftLoadN?: number;
  /** Combined normal force on right side wheels in Newtons (N) */
  rightLoadN?: number;
  /** Fraction of total weight on front axle */
  frontLoadFraction?: number;
  /** Fraction of total weight on rear axle */
  rearLoadFraction?: number;
  /** Fraction of total weight on left side */
  leftLoadFraction?: number;
  /** Fraction of total weight on right side */
  rightLoadFraction?: number;
  /** Normal force on passive 3rd support point (skid/caster) in 2WD mode in Newtons (N) */
  skidNormalForceN?: number;
  /** Mass equivalent on passive 3rd support point in kilograms (kg) */
  skidMassEquivalentKg?: number;
  /** Load fraction on passive 3rd support point */
  skidLoadFraction?: number;
  validity: CalculationValidity;
  assumptions: string[];
  warnings: string[];
};

export type SupportPolygonPoint = {
  x: number;
  z: number;
  label?: string;
};

export type SupportPolygon = {
  /** Ordered ground plane vertices forming the convex support boundary (CCW order) */
  vertices: SupportPolygonPoint[];
  /** Enclosed ground support area in square meters (m²) */
  areaM2: number;
  /** Geometric center of the support polygon */
  centroid: { x: number; z: number };
  boundingBox: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  validity: CalculationValidity;
  warnings: string[];
};

export type StaticStabilityProfile = {
  /** Whether the projected CoM lies securely within the support polygon with positive normal loads */
  isStaticallyStable: boolean;
  /** Categorized stability state */
  stabilityStatus: StabilityStatus;
  centerOfMass: CenterOfMass;
  wheelLoadDistribution: WheelLoadDistribution;
  supportPolygon: SupportPolygon;
  /** Forward tipping angle from vertical rest in degrees (°) */
  forwardTipAngleDeg?: number;
  /** Backward tipping angle from vertical rest in degrees (°) */
  backwardTipAngleDeg?: number;
  /** Left lateral tipping angle from vertical rest in degrees (°) */
  leftTipAngleDeg?: number;
  /** Right lateral tipping angle from vertical rest in degrees (°) */
  rightTipAngleDeg?: number;
  /** Minimum tipping angle to any support boundary in degrees (°) */
  minTipAngleDeg?: number;
  /** Longitudinal stability margin: min(forward, backward) in meters (m) */
  longitudinalStabilityMarginM?: number;
  /** Lateral stability margin: min(left, right) in meters (m) */
  lateralStabilityMarginM?: number;
  /** Perpendicular distance from projected CoM to forward support boundary in meters (m) */
  forwardStabilityMarginM?: number;
  /** Perpendicular distance from projected CoM to backward support boundary in meters (m) */
  backwardStabilityMarginM?: number;
  /** Perpendicular distance from projected CoM to left support boundary in meters (m) */
  leftStabilityMarginM?: number;
  /** Perpendicular distance from projected CoM to right support boundary in meters (m) */
  rightStabilityMarginM?: number;
  /** Minimum perpendicular distance from projected CoM to any polygon edge in meters (m) */
  minimumStabilityMarginM?: number;
  validity: CalculationValidity;
  assumptions: string[];
  warnings: string[];
};

export type RobotStabilityProfile = StaticStabilityProfile;

/** Minimum margin in meters to be classified as fully stable (below this is marginal) */
export const MARGINAL_STABILITY_THRESHOLD_M = 0.05; // 50 mm

/**
 * Derives the ground datum Y coordinate from mounted wheels or chassis geometry.
 *
 * Ground datum is defined by the lowest wheel contact elevation:
 * Y_ground = min(Y_wheel - radius_wheel)
 */
export function calculateGroundDatum(parts: RobotPart[]): {
  groundDatumY: number;
  validity: CalculationValidity;
  warnings: string[];
} {
  const warnings: string[] = [];
  const wheels = parts.filter((p) => p.type === "Wheel");

  if (wheels.length > 0) {
    let minWheelBottom = Infinity;
    let validWheelFound = false;

    for (const wheel of wheels) {
      const wheelRes = resolveWheelDimensions(wheel);
      if (wheelRes.isValid && wheelRes.radiusM > 0) {
        const bottomY = wheel.position[1] - wheelRes.radiusM;
        if (bottomY < minWheelBottom) {
          minWheelBottom = bottomY;
          validWheelFound = true;
        }
      }
    }

    if (validWheelFound) {
      return {
        groundDatumY: minWheelBottom,
        validity: "valid",
        warnings,
      };
    }
  }

  // Fallback to foundation chassis lowest elevation
  const chassis = parts.find(
    (p) =>
      p.foundationModelId !== undefined ||
      p.id === "foundation-chassis" ||
      (p.type === "Structural Block" &&
        p.engineeringSpec?.category === "structural" &&
        p.engineeringSpec.role === "chassis-frame")
  );

  if (chassis) {
    const heightM =
      (chassis.geometry?.shape === "box" ? chassis.geometry.height : undefined) ??
      chassis.size?.[1] ??
      0;
    const chassisBottomY = chassis.position[1] - heightM / 2;
    warnings.push(
      "Ground datum derived from chassis lower boundary because wheel dimensions are unavailable."
    );
    return {
      groundDatumY: chassisBottomY,
      validity: "marginal",
      warnings,
    };
  }

  warnings.push("Ground datum could not be established; defaulting to Y = 0.");
  return {
    groundDatumY: 0,
    validity: "unsupported",
    warnings,
  };
}

/**
 * Calculates the assembly Center of Mass (CoM) via weighted mass-moment calculation.
 *
 * xCoM = Σ(mᵢ × xᵢ) / Σmᵢ
 * yCoM = Σ(mᵢ × yᵢ) / Σmᵢ
 * zCoM = Σ(mᵢ × zᵢ) / Σmᵢ
 */
export function calculateCenterOfMass(
  parts: RobotPart[],
  groundDatumY?: number
): CenterOfMass {
  const warnings: string[] = [];

  if (!parts || parts.length === 0) {
    return {
      x: 0,
      y: 0,
      z: 0,
      heightAboveGroundM: 0,
      groundDatumY: groundDatumY ?? 0,
      totalMassKg: 0,
      validity: "unsupported",
      warnings: ["Assembly contains no components."],
    };
  }

  let totalMass = 0;
  let momentX = 0;
  let momentY = 0;
  let momentZ = 0;
  let hasInvalidPart = false;

  for (const part of parts) {
    const massRes = resolveComponentMass(part);
    if (!massRes.isValid) {
      hasInvalidPart = true;
      warnings.push(
        `Part "${part.name}" (${part.id}) has invalid or non-positive mass (${massRes.rawValue}); excluded from moments.`
      );
      continue;
    }

    const pos = part.position ?? [0, 0, 0];
    const px = Number.isFinite(pos[0]) ? pos[0] : 0;
    const py = Number.isFinite(pos[1]) ? pos[1] : 0;
    const pz = Number.isFinite(pos[2]) ? pos[2] : 0;

    totalMass += massRes.massKg;
    momentX += massRes.massKg * px;
    momentY += massRes.massKg * py;
    momentZ += massRes.massKg * pz;
  }

  if (totalMass <= 0) {
    return {
      x: 0,
      y: 0,
      z: 0,
      heightAboveGroundM: 0,
      groundDatumY: groundDatumY ?? 0,
      totalMassKg: 0,
      validity: "invalid",
      warnings: [
        ...warnings,
        "Total assembly mass is zero or negative; center of mass cannot be determined.",
      ],
    };
  }

  const x = momentX / totalMass;
  const y = momentY / totalMass;
  const z = momentZ / totalMass;

  const groundY = groundDatumY ?? calculateGroundDatum(parts).groundDatumY;
  const heightAboveGroundM = y - groundY;

  if (heightAboveGroundM <= 0) {
    warnings.push(
      "Calculated CoM height above ground datum is zero or negative; verify vertical component positions."
    );
  }

  warnings.push(
    "Component positions are treated as geometric centroids approximating component CoM."
  );

  return {
    x,
    y,
    z,
    heightAboveGroundM: Math.max(0, heightAboveGroundM),
    groundDatumY: groundY,
    totalMassKg: totalMass,
    validity: hasInvalidPart ? "marginal" : "valid",
    warnings,
  };
}

/**
 * Constructs the 2D ground support polygon from contact points on the (X, Z) plane.
 */
export function calculateSupportPolygon(
  parts: RobotPart[],
  _drivetrain?: DrivetrainConfiguration | null,
  com?: { x: number; z: number }
): SupportPolygon {
  const warnings: string[] = [];
  const wheels = parts.filter((p) => p.type === "Wheel");

  // Determine foundation chassis geometry if present
  const chassis = parts.find(
    (p) =>
      p.foundationModelId !== undefined ||
      p.id === "foundation-chassis" ||
      (p.type === "Structural Block" &&
        p.engineeringSpec?.category === "structural" &&
        p.engineeringSpec.role === "chassis-frame")
  );

  const chassisLengthM =
    (chassis?.geometry?.shape === "box" ? chassis.geometry.length : undefined) ??
    chassis?.size?.[0] ??
    0.8;
  const chassisX = chassis?.position[0] ?? 0;
  const chassisZ = chassis?.position[2] ?? 0;

  // 1. Four-wheel rectangular/quadrilateral polygon
  if (wheels.length >= 4) {
    const xCoords = wheels.map((w) => w.position[0]);
    const zCoords = wheels.map((w) => w.position[2]);

    const midX = (Math.min(...xCoords) + Math.max(...xCoords)) / 2;
    const midZ = (Math.min(...zCoords) + Math.max(...zCoords)) / 2;

    const fl = wheels.find((w) => w.position[0] >= midX && w.position[2] >= midZ);
    const fr = wheels.find((w) => w.position[0] >= midX && w.position[2] < midZ);
    const rl = wheels.find((w) => w.position[0] < midX && w.position[2] >= midZ);
    const rr = wheels.find((w) => w.position[0] < midX && w.position[2] < midZ);

    if (fl && fr && rl && rr) {
      // Counter-clockwise order: Front-Left -> Rear-Left -> Rear-Right -> Front-Right
      const vertices: SupportPolygonPoint[] = [
        { x: fl.position[0], z: fl.position[2], label: "Front-Left Wheel" },
        { x: rl.position[0], z: rl.position[2], label: "Rear-Left Wheel" },
        { x: rr.position[0], z: rr.position[2], label: "Rear-Right Wheel" },
        { x: fr.position[0], z: fr.position[2], label: "Front-Right Wheel" },
      ];

      const minX = Math.min(fl.position[0], fr.position[0], rl.position[0], rr.position[0]);
      const maxX = Math.max(fl.position[0], fr.position[0], rl.position[0], rr.position[0]);
      const minZ = Math.min(fl.position[2], fr.position[2], rl.position[2], rr.position[2]);
      const maxZ = Math.max(fl.position[2], fr.position[2], rl.position[2], rr.position[2]);

      const deltaX = maxX - minX;
      const deltaZ = maxZ - minZ;

      if (deltaX < 0.01 || deltaZ < 0.01) {
        return {
          vertices,
          areaM2: 0,
          centroid: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
          boundingBox: { minX, maxX, minZ, maxZ },
          validity: "unsupported",
          warnings: ["Wheel layout is collinear or degenerate; support polygon has near-zero area."],
        };
      }

      // Shoelace formula for area
      let areaSum = 0;
      for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        areaSum += vertices[i].x * vertices[j].z - vertices[j].x * vertices[i].z;
      }
      const areaM2 = Math.abs(areaSum) / 2;

      return {
        vertices,
        areaM2,
        centroid: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
        boundingBox: { minX, maxX, minZ, maxZ },
        validity: "valid",
        warnings,
      };
    }
  }

  // 2. Two-wheel differential drive: 3-point support model (2 driven wheels + passive skid/caster)
  if (wheels.length === 2) {
    const leftWheel = wheels.find((w) => w.position[2] >= 0) ?? wheels[0];
    const rightWheel = wheels.find((w) => w.position[2] < 0) ?? wheels[1];

    const axleX = (leftWheel.position[0] + rightWheel.position[0]) / 2;
    const comX = com?.x ?? axleX;

    // Longitudinal chassis edges
    const frontEdgeX = chassisX + chassisLengthM / 2;
    const rearEdgeX = chassisX - chassisLengthM / 2;

    // Determine active skid point based on CoM pitch moment about axle
    const isForwardTipped = comX >= axleX;
    const skidX = isForwardTipped ? frontEdgeX : rearEdgeX;
    const skidZ = chassisZ;

    warnings.push(
      `2WD configuration assumes a passive 3rd contact point (skid/caster) located at the chassis ${
        isForwardTipped ? "front" : "rear"
      } edge (${skidX.toFixed(2)} m, ${skidZ.toFixed(2)} m).`
    );

    // CCW vertices
    let vertices: SupportPolygonPoint[];
    if (isForwardTipped) {
      // Skid (front) -> Left Wheel (rear-left) -> Right Wheel (rear-right)
      vertices = [
        { x: skidX, z: skidZ, label: "Front Passive Skid" },
        { x: leftWheel.position[0], z: leftWheel.position[2], label: "Left Driven Wheel" },
        { x: rightWheel.position[0], z: rightWheel.position[2], label: "Right Driven Wheel" },
      ];
    } else {
      // Left Wheel -> Rear Skid -> Right Wheel
      vertices = [
        { x: leftWheel.position[0], z: leftWheel.position[2], label: "Left Driven Wheel" },
        { x: skidX, z: skidZ, label: "Rear Passive Skid" },
        { x: rightWheel.position[0], z: rightWheel.position[2], label: "Right Driven Wheel" },
      ];
    }

    const minX = Math.min(...vertices.map((v) => v.x));
    const maxX = Math.max(...vertices.map((v) => v.x));
    const minZ = Math.min(...vertices.map((v) => v.z));
    const maxZ = Math.max(...vertices.map((v) => v.z));

    const baselineL = Math.abs(skidX - axleX);
    const trackW = Math.abs(leftWheel.position[2] - rightWheel.position[2]);

    if (baselineL < 0.01 || trackW < 0.01) {
      return {
        vertices,
        areaM2: 0,
        centroid: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
        boundingBox: { minX, maxX, minZ, maxZ },
        validity: "unsupported",
        warnings: [
          ...warnings,
          "Support triangle baseline or track width is degenerate (< 0.01 m).",
        ],
      };
    }

    // Triangle area = 0.5 * baseline * trackWidth
    const areaM2 = 0.5 * baselineL * trackW;

    return {
      vertices,
      areaM2,
      centroid: {
        x: (vertices[0].x + vertices[1].x + vertices[2].x) / 3,
        z: (vertices[0].z + vertices[1].z + vertices[2].z) / 3,
      },
      boundingBox: { minX, maxX, minZ, maxZ },
      validity: "valid",
      warnings,
    };
  }

  // 3. Fallback for configurations with unsupported wheel counts (< 2 or 3)
  return {
    vertices: [],
    areaM2: 0,
    centroid: { x: 0, z: 0 },
    boundingBox: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    validity: "unsupported",
    warnings: [
      `Support polygon requires 2 or 4 mounted wheels (found ${wheels.length}).`,
    ],
  };
}

/**
 * Calculates per-wheel static normal load distribution and driven-wheel load metrics.
 *
 * Conserves total vertical force: Σ Nᵢ = M_total × g
 */
export function calculateWheelLoadDistribution(
  parts: RobotPart[],
  _connections: RobotConnection[],
  drivetrain: DrivetrainConfiguration | null | undefined,
  com: CenterOfMass,
  supportPolygon?: SupportPolygon
): WheelLoadDistribution {
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const totalMassKg = com.totalMassKg;
  const totalNormalForceN = totalMassKg * STANDARD_GRAVITY_MPS2;

  if (totalMassKg <= 0 || com.validity === "invalid") {
    return {
      totalMassKg: 0,
      totalNormalForceN: 0,
      drivenNormalForceN: 0,
      drivenMassEquivalentKg: 0,
      drivenLoadFraction: 0,
      perWheelLoads: [],
      validity: "invalid",
      assumptions: ["Invalid or zero assembly mass."],
      warnings: ["Cannot compute wheel load distribution without positive total mass."],
    };
  }

  const polygon = supportPolygon ?? calculateSupportPolygon(parts, drivetrain, com);
  const wheels = parts.filter((p) => p.type === "Wheel");

  // Determine driven wheel IDs from drivetrain configuration
  const drivenWheelIds = new Set<string>();
  if (drivetrain) {
    for (const side of ["left", "right"] as const) {
      for (const assignment of drivetrain[side]) {
        if (assignment?.wheelId) {
          drivenWheelIds.add(assignment.wheelId);
        }
      }
    }
  }

  // 1. Four-wheel bilinear planar load-distribution model
  if (wheels.length >= 4 && polygon.validity === "valid") {
    assumptions.push(
      "4-wheel loads calculated using an idealized planar bilinear load-distribution model assuming rigid chassis and flat ground datum; static indeterminacy is resolved via planar interpolation."
    );

    const xCoords = wheels.map((w) => w.position[0]);
    const zCoords = wheels.map((w) => w.position[2]);

    const midX = (Math.min(...xCoords) + Math.max(...xCoords)) / 2;
    const midZ = (Math.min(...zCoords) + Math.max(...zCoords)) / 2;

    const fl = wheels.find((w) => w.position[0] >= midX && w.position[2] >= midZ);
    const fr = wheels.find((w) => w.position[0] >= midX && w.position[2] < midZ);
    const rl = wheels.find((w) => w.position[0] < midX && w.position[2] >= midZ);
    const rr = wheels.find((w) => w.position[0] < midX && w.position[2] < midZ);

    if (fl && fr && rl && rr) {
      const xF = (fl.position[0] + fr.position[0]) / 2;
      const xR = (rl.position[0] + rr.position[0]) / 2;
      const zL = (fl.position[2] + rl.position[2]) / 2;
      const zR = (fr.position[2] + rr.position[2]) / 2;

      const wheelbaseL = xF - xR;
      const trackWidthW = zL - zR;

      if (wheelbaseL <= 0.005 || trackWidthW <= 0.005) {
        return {
          totalMassKg,
          totalNormalForceN,
          drivenNormalForceN: 0,
          drivenMassEquivalentKg: 0,
          drivenLoadFraction: 0,
          perWheelLoads: [],
          validity: "unsupported",
          assumptions,
          warnings: ["Wheelbase or track width is degenerate."],
        };
      }

      // Longitudinal and lateral split fractions
      const alphaFront = (com.x - xR) / wheelbaseL;
      const alphaRear = (xF - com.x) / wheelbaseL;
      const betaLeft = (com.z - zR) / trackWidthW;
      const betaRight = (zL - com.z) / trackWidthW;

      const nFL = alphaFront * betaLeft * totalNormalForceN;
      const nFR = alphaFront * betaRight * totalNormalForceN;
      const nRL = alphaRear * betaLeft * totalNormalForceN;
      const nRR = alphaRear * betaRight * totalNormalForceN;

      let hasNegativeLoad = false;
      const wheelLoads: PerWheelLoad[] = [
        {
          partId: fl.id,
          name: fl.name,
          position: fl.position,
          location: "front-left",
          isDriven: drivenWheelIds.has(fl.id),
          normalForceN: nFL,
          massEquivalentKg: nFL / STANDARD_GRAVITY_MPS2,
          loadFraction: nFL / totalNormalForceN,
        },
        {
          partId: fr.id,
          name: fr.name,
          position: fr.position,
          location: "front-right",
          isDriven: drivenWheelIds.has(fr.id),
          normalForceN: nFR,
          massEquivalentKg: nFR / STANDARD_GRAVITY_MPS2,
          loadFraction: nFR / totalNormalForceN,
        },
        {
          partId: rl.id,
          name: rl.name,
          position: rl.position,
          location: "rear-left",
          isDriven: drivenWheelIds.has(rl.id),
          normalForceN: nRL,
          massEquivalentKg: nRL / STANDARD_GRAVITY_MPS2,
          loadFraction: nRL / totalNormalForceN,
        },
        {
          partId: rr.id,
          name: rr.name,
          position: rr.position,
          location: "rear-right",
          isDriven: drivenWheelIds.has(rr.id),
          normalForceN: nRR,
          massEquivalentKg: nRR / STANDARD_GRAVITY_MPS2,
          loadFraction: nRR / totalNormalForceN,
        },
      ];

      for (const w of wheelLoads) {
        if (w.normalForceN < -0.001) {
          hasNegativeLoad = true;
          warnings.push(
            `Negative normal force calculated on ${w.name} (${w.normalForceN.toFixed(1)} N); robot is statically unstable.`
          );
        }
      }

      const frontLoadN = nFL + nFR;
      const rearLoadN = nRL + nRR;
      const leftLoadN = nFL + nRL;
      const rightLoadN = nFR + nRR;

      const drivenNormalForceN = wheelLoads
        .filter((w) => w.isDriven)
        .reduce((sum, w) => sum + Math.max(0, w.normalForceN), 0);
      const drivenLoadFraction =
        totalNormalForceN > 0 ? drivenNormalForceN / totalNormalForceN : 0;
      const drivenMassEquivalentKg = drivenLoadFraction * totalMassKg;

      return {
        totalMassKg,
        totalNormalForceN,
        drivenNormalForceN,
        drivenMassEquivalentKg,
        drivenLoadFraction,
        perWheelLoads: wheelLoads,
        frontLoadN,
        rearLoadN,
        leftLoadN,
        rightLoadN,
        frontLoadFraction: frontLoadN / totalNormalForceN,
        rearLoadFraction: rearLoadN / totalNormalForceN,
        leftLoadFraction: leftLoadN / totalNormalForceN,
        rightLoadFraction: rightLoadN / totalNormalForceN,
        validity: hasNegativeLoad ? "invalid" : "valid",
        assumptions,
        warnings,
      };
    }
  }

  // 2. Two-wheel 3-point static equilibrium model
  if (wheels.length === 2 && polygon.validity === "valid") {
    assumptions.push(
      "2-wheel loads calculated using 3-point static equilibrium with two driven wheels and an assumed passive chassis skid contact."
    );

    const leftWheel = wheels.find((w) => w.position[2] >= 0) ?? wheels[0];
    const rightWheel = wheels.find((w) => w.position[2] < 0) ?? wheels[1];

    const axleX = (leftWheel.position[0] + rightWheel.position[0]) / 2;
    const trackWidthW = Math.abs(leftWheel.position[2] - rightWheel.position[2]);

    // Active skid vertex from polygon
    const skidVertex = polygon.vertices.find((v) => v.label?.includes("Skid"));
    const skidX = skidVertex ? skidVertex.x : axleX + 0.4;
    const baselineL = Math.abs(skidX - axleX);

    if (baselineL <= 0.005 || trackWidthW <= 0.005) {
      return {
        totalMassKg,
        totalNormalForceN,
        drivenNormalForceN: 0,
        drivenMassEquivalentKg: 0,
        drivenLoadFraction: 0,
        perWheelLoads: [],
        validity: "unsupported",
        assumptions,
        warnings: ["2WD baseline or track width is degenerate (< 0.005 m)."],
      };
    }

    // Moments about skid and axle
    // Normal force on skid: N_skid = W_total * (|xCoM - xAxle| / baselineL)
    const distFromAxle = Math.abs(com.x - axleX);
    const skidNormalForceN = totalNormalForceN * (distFromAxle / baselineL);
    const axleNormalForceN = totalNormalForceN - skidNormalForceN;

    // Lateral distribution across driven wheels
    const deltaZ = com.z - (leftWheel.position[2] + rightWheel.position[2]) / 2;
    const lateralShiftN = totalNormalForceN * (deltaZ / trackWidthW);

    const nLeft = axleNormalForceN / 2 + lateralShiftN;
    const nRight = axleNormalForceN / 2 - lateralShiftN;

    let hasNegativeLoad = false;
    if (nLeft < -0.001 || nRight < -0.001 || skidNormalForceN < -0.001 || axleNormalForceN < -0.001) {
      hasNegativeLoad = true;
      warnings.push(
        "One or more support reactions are negative; projected CoM lies outside the support triangle."
      );
    }

    const wheelLoads: PerWheelLoad[] = [
      {
        partId: leftWheel.id,
        name: leftWheel.name,
        position: leftWheel.position,
        location: "left",
        isDriven: drivenWheelIds.has(leftWheel.id) || true, // 2WD assumes both assigned
        normalForceN: nLeft,
        massEquivalentKg: nLeft / STANDARD_GRAVITY_MPS2,
        loadFraction: nLeft / totalNormalForceN,
      },
      {
        partId: rightWheel.id,
        name: rightWheel.name,
        position: rightWheel.position,
        location: "right",
        isDriven: drivenWheelIds.has(rightWheel.id) || true,
        normalForceN: nRight,
        massEquivalentKg: nRight / STANDARD_GRAVITY_MPS2,
        loadFraction: nRight / totalNormalForceN,
      },
    ];

    const drivenNormalForceN = Math.max(0, nLeft) + Math.max(0, nRight);
    const drivenLoadFraction =
      totalNormalForceN > 0 ? drivenNormalForceN / totalNormalForceN : 0;
    const drivenMassEquivalentKg = drivenLoadFraction * totalMassKg;

    const skidMassEquivalentKg = skidNormalForceN / STANDARD_GRAVITY_MPS2;
    const skidLoadFraction = skidNormalForceN / totalNormalForceN;

    const isSkidFront = skidX > axleX;
    const frontLoadN = isSkidFront ? skidNormalForceN : axleNormalForceN;
    const rearLoadN = isSkidFront ? axleNormalForceN : skidNormalForceN;

    return {
      totalMassKg,
      totalNormalForceN,
      drivenNormalForceN,
      drivenMassEquivalentKg,
      drivenLoadFraction,
      perWheelLoads: wheelLoads,
      frontLoadN,
      rearLoadN,
      leftLoadN: nLeft,
      rightLoadN: nRight,
      frontLoadFraction: frontLoadN / totalNormalForceN,
      rearLoadFraction: rearLoadN / totalNormalForceN,
      leftLoadFraction: nLeft / totalNormalForceN,
      rightLoadFraction: nRight / totalNormalForceN,
      skidNormalForceN,
      skidMassEquivalentKg,
      skidLoadFraction,
      validity: hasNegativeLoad ? "invalid" : "valid",
      assumptions,
      warnings,
    };
  }

  // 3. Fallback for unconfigured or unsupported wheel counts
  assumptions.push("Support geometry does not match standard 2WD or 4WD planar models.");
  return {
    totalMassKg,
    totalNormalForceN,
    drivenNormalForceN: 0,
    drivenMassEquivalentKg: 0,
    drivenLoadFraction: 0,
    perWheelLoads: [],
    validity: "unsupported",
    assumptions,
    warnings: [
      `Wheel load distribution unsupported for ${wheels.length} wheel(s).`,
    ],
  };
}

/**
 * Calculates perpendicular distances from projected CoM (x, z) to polygon edges and boundaries.
 */
export function calculateStaticStabilityMargins(
  polygon: SupportPolygon,
  com: CenterOfMass
): {
  forwardMarginM?: number;
  backwardMarginM?: number;
  leftMarginM?: number;
  rightMarginM?: number;
  minMarginM?: number;
  isInside: boolean;
} {
  if (polygon.validity !== "valid" || polygon.vertices.length < 3) {
    return { isInside: false };
  }

  const px = com.x;
  const pz = com.z;
  const { minX, maxX, minZ, maxZ } = polygon.boundingBox;

  // Directional margins to bounding boundaries
  const forwardMarginM = maxX - px;
  const backwardMarginM = px - minX;
  const leftMarginM = maxZ - pz;
  const rightMarginM = pz - minZ;

  // Point-in-polygon check for convex polygon using edge sign consistency
  const vertices = polygon.vertices;
  const n = vertices.length;
  let allPositive = true;
  let allNegative = true;
  let minPerpDist = Infinity;

  for (let i = 0; i < n; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % n];

    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const cross = dx * (pz - p1.z) - dz * (px - p1.x);

    if (cross > 1e-9) allNegative = false;
    if (cross < -1e-9) allPositive = false;

    // Perpendicular distance to line segment
    const edgeLength = Math.hypot(dx, dz);
    if (edgeLength > 1e-6) {
      const perpDist = Math.abs(dz * px - dx * pz + p2.x * p1.z - p2.z * p1.x) / edgeLength;
      if (perpDist < minPerpDist) {
        minPerpDist = perpDist;
      }
    }
  }

  const isInside = allPositive || allNegative;
  const minMarginM = isInside ? minPerpDist : 0;

  return {
    forwardMarginM: Math.max(0, forwardMarginM),
    backwardMarginM: Math.max(0, backwardMarginM),
    leftMarginM: Math.max(0, leftMarginM),
    rightMarginM: Math.max(0, rightMarginM),
    minMarginM,
    isInside,
  };
}

/**
 * Calculates static tipping angles relative to support polygon boundaries.
 *
 * θ = arctan(d / h)
 *
 * NOTE: If the configuration is unstable (CoM outside support polygon), all angles report 0°.
 */
export function calculateStaticTippingAngles(
  margins: {
    forwardMarginM?: number;
    backwardMarginM?: number;
    leftMarginM?: number;
    rightMarginM?: number;
    minMarginM?: number;
  },
  heightAboveGroundM: number,
  isStaticallyStable: boolean
): {
  forwardTipAngleDeg?: number;
  backwardTipAngleDeg?: number;
  leftTipAngleDeg?: number;
  rightTipAngleDeg?: number;
  minTipAngleDeg?: number;
} {
  if (!isStaticallyStable) {
    return {
      forwardTipAngleDeg: 0,
      backwardTipAngleDeg: 0,
      leftTipAngleDeg: 0,
      rightTipAngleDeg: 0,
      minTipAngleDeg: 0,
    };
  }

  if (heightAboveGroundM <= 0 || !Number.isFinite(heightAboveGroundM)) {
    return {};
  }

  const toDeg = (distM?: number) => {
    if (distM === undefined || !Number.isFinite(distM) || distM < 0) return 0;
    return Math.atan2(distM, heightAboveGroundM) * (180 / Math.PI);
  };

  return {
    forwardTipAngleDeg: toDeg(margins.forwardMarginM),
    backwardTipAngleDeg: toDeg(margins.backwardMarginM),
    leftTipAngleDeg: toDeg(margins.leftMarginM),
    rightTipAngleDeg: toDeg(margins.rightMarginM),
    minTipAngleDeg: toDeg(margins.minMarginM),
  };
}

/**
 * Pure compiler that derives the complete RobotStabilityProfile from current assembly state.
 */
export function compileRobotStabilityProfile(
  parts: RobotPart[],
  connections: RobotConnection[],
  drivetrain?: DrivetrainConfiguration | null
): RobotStabilityProfile {
  const assumptions: string[] = [];
  const warnings: string[] = [];

  // 1. Center of Mass
  const groundDatumResult = calculateGroundDatum(parts);
  const com = calculateCenterOfMass(parts, groundDatumResult.groundDatumY);
  warnings.push(...groundDatumResult.warnings, ...com.warnings);

  // Guard against missing assembly
  if (parts.length === 0 || com.totalMassKg <= 0) {
    return {
      isStaticallyStable: false,
      stabilityStatus: "unsupported",
      centerOfMass: com,
      wheelLoadDistribution: {
        totalMassKg: 0,
        totalNormalForceN: 0,
        drivenNormalForceN: 0,
        drivenMassEquivalentKg: 0,
        drivenLoadFraction: 0,
        perWheelLoads: [],
        validity: "unsupported",
        assumptions: [],
        warnings: ["Assembly has no mass."],
      },
      supportPolygon: {
        vertices: [],
        areaM2: 0,
        centroid: { x: 0, z: 0 },
        boundingBox: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
        validity: "unsupported",
        warnings: [],
      },
      validity: "unsupported",
      assumptions: ["No assembly components present."],
      warnings: ["Cannot evaluate stability for empty assembly."],
    };
  }

  // 2. Support Polygon
  const polygon = calculateSupportPolygon(parts, drivetrain, com);
  warnings.push(...polygon.warnings);

  // 3. Wheel Load Distribution
  const loadDistribution = calculateWheelLoadDistribution(
    parts,
    connections,
    drivetrain,
    com,
    polygon
  );
  warnings.push(...loadDistribution.warnings);
  assumptions.push(...loadDistribution.assumptions);

  // 4. Margins and Stability Assessment
  const margins = calculateStaticStabilityMargins(polygon, com);

  let stabilityStatus: StabilityStatus;
  let isStaticallyStable: boolean;

  if (polygon.validity === "valid" && loadDistribution.validity !== "unsupported") {
    if (!margins.isInside || loadDistribution.validity === "invalid") {
      stabilityStatus = "unstable";
      isStaticallyStable = false;
      warnings.push(
        "Projected CoM lies outside the support polygon or produces negative wheel normal reactions; robot is statically unstable."
      );
    } else if (
      margins.minMarginM !== undefined &&
      margins.minMarginM < MARGINAL_STABILITY_THRESHOLD_M
    ) {
      stabilityStatus = "marginal";
      isStaticallyStable = true;
      warnings.push(
        `Minimum stability margin is under ${(MARGINAL_STABILITY_THRESHOLD_M * 1000).toFixed(0)} mm; configuration has marginal tipping resistance.`
      );
    } else {
      stabilityStatus = "stable";
      isStaticallyStable = true;
    }
  } else {
    stabilityStatus = "unsupported";
    isStaticallyStable = false;
  }

  // 5. Static Tipping Angles
  const tippingAngles = calculateStaticTippingAngles(
    margins,
    com.heightAboveGroundM,
    isStaticallyStable
  );

  assumptions.push(
    "Static tipping thresholds represent edge-based static tilt limits (θ = arctan(d/h)); dynamic rollover, suspension deflection and chassis compliance are not modeled."
  );

  const longitudinalStabilityMarginM =
    margins.forwardMarginM !== undefined && margins.backwardMarginM !== undefined
      ? Math.min(margins.forwardMarginM, margins.backwardMarginM)
      : undefined;

  const lateralStabilityMarginM =
    margins.leftMarginM !== undefined && margins.rightMarginM !== undefined
      ? Math.min(margins.leftMarginM, margins.rightMarginM)
      : undefined;

  let overallValidity: CalculationValidity = "valid";
  if (stabilityStatus === "unsupported" || com.validity === "unsupported") {
    overallValidity = "unsupported";
  } else if (stabilityStatus === "unstable" || loadDistribution.validity === "invalid") {
    overallValidity = "invalid";
  } else if (stabilityStatus === "marginal" || com.validity === "marginal") {
    overallValidity = "marginal";
  }

  return {
    isStaticallyStable,
    stabilityStatus,
    centerOfMass: com,
    wheelLoadDistribution: loadDistribution,
    supportPolygon: polygon,
    forwardTipAngleDeg: tippingAngles.forwardTipAngleDeg,
    backwardTipAngleDeg: tippingAngles.backwardTipAngleDeg,
    leftTipAngleDeg: tippingAngles.leftTipAngleDeg,
    rightTipAngleDeg: tippingAngles.rightTipAngleDeg,
    minTipAngleDeg: tippingAngles.minTipAngleDeg,
    longitudinalStabilityMarginM,
    lateralStabilityMarginM,
    forwardStabilityMarginM: margins.forwardMarginM,
    backwardStabilityMarginM: margins.backwardMarginM,
    leftStabilityMarginM: margins.leftMarginM,
    rightStabilityMarginM: margins.rightMarginM,
    minimumStabilityMarginM: margins.minMarginM,
    validity: overallValidity,
    assumptions,
    warnings: Array.from(new Set(warnings)),
  };
}
