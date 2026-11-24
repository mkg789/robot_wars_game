/**
 * Pure analytical calculation engine for component and assembly rotational mass properties
 * (inertia tensors, principal moments of inertia, and radii of gyration).
 *
 * NOTE: This is an analytical engineering module, NOT a dynamic physics simulation.
 * All calculations are deterministic, zero-dependency, and completely decoupled from React,
 * Three.js runtime classes, Zustand mutations, and physics engines.
 *
 * Canonical Robot Coordinate Frame:
 * - +X = Front / Longitudinal (Length) -> Rotation around X is Roll (Ixx)
 * - +Y = Up / Vertical (Height)        -> Rotation around Y is Yaw (Iyy)
 * - +Z = Left / Lateral (Width)        -> Rotation around Z is Pitch (Izz)
 */

import type {
  DrivetrainConfiguration,
  RobotPart,
} from "../types/robot.types";
import { getPartBoundingExtents } from "./geometryAdapters";
import {
  calculateCenterOfMass,
  type CalculationValidity,
  type CenterOfMass,
} from "./robotStability";

/**
 * 3x3 symmetric inertia matrix in canonical SI units (kg·m²).
 * Row 0: [Ixx, Ixy, Ixz]
 * Row 1: [Iyx, Iyy, Iyz]
 * Row 2: [Izx, Izy, Izz]
 */
export type InertiaMatrix3x3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number]
];

export type PrincipalMomentsOfInertia = {
  /** Roll moment of inertia about canonical longitudinal X axis (+X Front) in kg·m² */
  readonly ixx: number;
  /** Yaw moment of inertia about canonical vertical Y axis (+Y Up) in kg·m² */
  readonly iyy: number;
  /** Pitch moment of inertia about canonical lateral Z axis (+Z Left) in kg·m² */
  readonly izz: number;
};

export type RadiiOfGyration = {
  /** Radius of gyration about X axis in canonical meters (m) */
  readonly kx: number;
  /** Radius of gyration about Y axis in canonical meters (m) */
  readonly ky: number;
  /** Radius of gyration about Z axis in canonical meters (m) */
  readonly kz: number;
};

export type ComponentInertia = {
  readonly partId: string;
  readonly name: string;
  readonly massKg: number;
  /** Centroidal inertia tensor in component-local coordinates in kg·m² */
  readonly localInertia: InertiaMatrix3x3;
  /** Centroidal inertia tensor rotated into robot global orientation in kg·m² */
  readonly orientedInertia: InertiaMatrix3x3;
  /** Inertia tensor translated to robot assembly center of mass via parallel-axis theorem in kg·m² */
  readonly transferredInertia: InertiaMatrix3x3;
  readonly isApproximated: boolean;
  readonly warnings: string[];
};

export type RobotInertiaProfile = {
  /** Total mass used for inertia calculations in canonical kilograms */
  readonly totalMassKg: number;
  /** Center of mass reference origin */
  readonly centerOfMass: CenterOfMass;
  /** Full 3x3 symmetric inertia tensor about assembly CoM in kg·m² */
  readonly tensor: InertiaMatrix3x3;
  /** Diagonal principal moments of inertia in kg·m² */
  readonly principalMoments: PrincipalMomentsOfInertia;
  /** Radii of gyration in meters */
  readonly radiiOfGyration: RadiiOfGyration;
  /** Detailed component-by-component inertia breakdown */
  readonly componentInertias: ComponentInertia[];
  readonly validity: CalculationValidity;
  readonly assumptions: string[];
  readonly warnings: string[];
};

/**
 * Creates a 3x3 zero matrix.
 */
export function createZeroInertiaMatrix(): InertiaMatrix3x3 {
  return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
}

/**
 * Converts Three.js canonical Euler angles (in radians, "XYZ" intrinsic / extrinsic order)
 * into a pure 3x3 orthogonal direction cosine rotation matrix R.
 *
 * Transformation: v_world = R * v_local
 *
 * For order 'XYZ':
 * R = R_x(phi) * R_y(theta) * R_z(psi)
 */
export function eulerToRotationMatrix(
  euler: readonly [number, number, number]
): [[number, number, number], [number, number, number], [number, number, number]] {
  const [x, y, z] = euler;

  // Optimize trivial identity rotation
  if (x === 0 && y === 0 && z === 0) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }

  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);

  const ae = a * e, af = a * f, be = b * e, bf = b * f;

  return [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ];
}

/**
 * Rotates an inertia tensor into global orientation using similarity transformation:
 * I_oriented = R * I_local * R^T
 *
 * Enforces strict symmetry of the resulting tensor to mitigate floating-point drift.
 */
export function rotateInertiaTensor(
  tensor: InertiaMatrix3x3,
  rotation: readonly [number, number, number]
): InertiaMatrix3x3 {
  const [rx, ry, rz] = rotation;
  if (rx === 0 && ry === 0 && rz === 0) {
    return tensor;
  }

  const R = eulerToRotationMatrix(rotation);

  // M = R * I
  const M: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      M[i][j] =
        R[i][0] * tensor[0][j] +
        R[i][1] * tensor[1][j] +
        R[i][2] * tensor[2][j];
    }
  }

  // Out = M * R^T
  const out: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] =
        M[i][0] * R[j][0] +
        M[i][1] * R[j][1] +
        M[i][2] * R[j][2];
    }
  }

  // Enforce numerical symmetry: I_ij = (I_ij + I_ji) / 2
  const s01 = (out[0][1] + out[1][0]) / 2;
  const s02 = (out[0][2] + out[2][0]) / 2;
  const s12 = (out[1][2] + out[2][1]) / 2;

  return [
    [out[0][0], s01, s02],
    [s01, out[1][1], s12],
    [s02, s12, out[2][2]],
  ];
}

/**
 * Translates an inertia tensor from a component centroid to the assembly center of mass
 * using Steiner's parallel-axis theorem:
 *
 * I_transferred = I_oriented + m (|d|² I_3 - d * d^T)
 *
 * where d = r_part - r_com = [dx, dy, dz].
 */
export function translateInertiaTensor(
  tensor: InertiaMatrix3x3,
  massKg: number,
  displacementM: readonly [number, number, number]
): InertiaMatrix3x3 {
  if (massKg <= 0 || !Number.isFinite(massKg)) {
    return tensor;
  }

  const [dx, dy, dz] = displacementM;
  if (dx === 0 && dy === 0 && dz === 0) {
    return tensor;
  }

  const dx2 = dx * dx;
  const dy2 = dy * dy;
  const dz2 = dz * dz;

  // Diagonal additions: m * (r_j² + r_k²)
  const deltaIxx = massKg * (dy2 + dz2);
  const deltaIyy = massKg * (dx2 + dz2);
  const deltaIzz = massKg * (dx2 + dy2);

  // Off-diagonal additions: -m * di * dj (standard rigid-body tensor sign convention where L = I * w)
  const deltaIxy = -massKg * dx * dy;
  const deltaIxz = -massKg * dx * dz;
  const deltaIyz = -massKg * dy * dz;

  return [
    [tensor[0][0] + deltaIxx, tensor[0][1] + deltaIxy, tensor[0][2] + deltaIxz],
    [tensor[1][0] + deltaIxy, tensor[1][1] + deltaIyy, tensor[1][2] + deltaIyz],
    [tensor[2][0] + deltaIxz, tensor[2][1] + deltaIyz, tensor[2][2] + deltaIzz],
  ];
}

/**
 * Calculates the local centroidal inertia tensor for an individual RobotPart.
 *
 * Supports:
 * - Uniform rectangular cuboid (BoxGeometry)
 * - Uniform solid cylinder (CylinderGeometry with axis "x" | "y" | "z")
 * - Bounding-box fallback for legacy components
 */
export function calculateLocalComponentInertia(part: RobotPart): {
  tensor: InertiaMatrix3x3;
  isApproximated: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const rawMass = part.massKg ?? part.mass;

  if (rawMass === undefined || rawMass === null || !Number.isFinite(rawMass) || rawMass <= 0) {
    return {
      tensor: createZeroInertiaMatrix(),
      isApproximated: true,
      warnings: [`Component "${part.name}" (${part.id}) has invalid or non-positive mass (${rawMass}).`],
    };
  }

  const m = rawMass;

  // 1. Canonical BoxGeometry: uniform solid rectangular cuboid
  if (part.geometry && part.geometry.shape === "box") {
    const { length: L, height: H, width: W } = part.geometry;

    if (L > 0 && H > 0 && W > 0 && Number.isFinite(L) && Number.isFinite(H) && Number.isFinite(W)) {
      const ixx = (m * (H * H + W * W)) / 12;
      const iyy = (m * (L * L + W * W)) / 12;
      const izz = (m * (L * L + H * H)) / 12;

      return {
        tensor: [
          [ixx, 0, 0],
          [0, iyy, 0],
          [0, 0, izz],
        ],
        isApproximated: false,
        warnings,
      };
    }
  }

  // 2. Canonical CylinderGeometry: uniform solid cylinder
  if (part.geometry && part.geometry.shape === "cylinder") {
    const { diameter: D, axialWidth: h, axis } = part.geometry;

    if (D > 0 && h > 0 && Number.isFinite(D) && Number.isFinite(h)) {
      const R = D / 2;
      const iAxial = (m * R * R) / 2;
      const iTransverse = (m * (3 * R * R + h * h)) / 12;

      let ixx: number;
      let iyy: number;
      let izz: number;

      switch (axis) {
        case "x":
          ixx = iAxial;
          iyy = iTransverse;
          izz = iTransverse;
          break;
        case "y":
          ixx = iTransverse;
          iyy = iAxial;
          izz = iTransverse;
          break;
        case "z":
        default:
          ixx = iTransverse;
          iyy = iTransverse;
          izz = iAxial;
          break;
      }

      return {
        tensor: [
          [ixx, 0, 0],
          [0, iyy, 0],
          [0, 0, izz],
        ],
        isApproximated: false,
        warnings,
      };
    }
  }

  // 3. Bounding-box fallback using Cartesian extents
  const extents = getPartBoundingExtents(part);
  const [L, H, W] = extents;

  if (L > 0 && H > 0 && W > 0 && Number.isFinite(L) && Number.isFinite(H) && Number.isFinite(W)) {
    const ixx = (m * (H * H + W * W)) / 12;
    const iyy = (m * (L * L + W * W)) / 12;
    const izz = (m * (L * L + H * H)) / 12;

    warnings.push(
      `Component "${part.name}" (${part.id}) lacks canonical geometry; local inertia approximated as uniform cuboid from bounding box [${L.toFixed(2)}m, ${H.toFixed(2)}m, ${W.toFixed(2)}m].`
    );

    return {
      tensor: [
        [ixx, 0, 0],
        [0, iyy, 0],
        [0, 0, izz],
      ],
      isApproximated: true,
      warnings,
    };
  }

  // 4. Missing dimensional data: treat as point mass at centroid
  warnings.push(
    `Component "${part.name}" (${part.id}) has invalid or missing dimensional geometry; centroidal inertia is assumed zero (point mass).`
  );

  return {
    tensor: createZeroInertiaMatrix(),
    isApproximated: true,
    warnings,
  };
}

/**
 * Pure compiler that derives the complete RobotInertiaProfile from current assembly state.
 *
 * Aggregates component centroidal inertias, rotates each into global coordinates,
 * translates each to the robot assembly center of mass via Steiner's parallel-axis theorem,
 * and extracts principal moments and radii of gyration.
 */
export function compileRobotInertiaProfile(
  parts: RobotPart[],
  _drivetrain?: DrivetrainConfiguration | null,
  comInput?: CenterOfMass
): RobotInertiaProfile {
  const assumptions: string[] = [
    "Components modeled as uniform homogeneous solids (rectangular cuboids or cylinders). Internal density variations (e.g. motor windings vs casings) are neglected.",
    "Chassis frame modeled as uniform solid box; actual hollow or tubular frame construction is not modeled.",
    "Component positions are treated as geometric centroids approximating internal component centers of mass.",
  ];
  const warnings: string[] = [];

  // 1. Center of mass resolution
  const com = comInput ?? calculateCenterOfMass(parts);
  warnings.push(...com.warnings);

  if (parts.length === 0 || com.totalMassKg <= 0 || com.validity === "unsupported") {
    return {
      totalMassKg: 0,
      centerOfMass: com,
      tensor: createZeroInertiaMatrix(),
      principalMoments: { ixx: 0, iyy: 0, izz: 0 },
      radiiOfGyration: { kx: 0, ky: 0, kz: 0 },
      componentInertias: [],
      validity: "unsupported",
      assumptions,
      warnings: ["Cannot evaluate rotational mass properties for an empty assembly or assembly with zero mass."],
    };
  }

  let totalIxx = 0;
  let totalIyy = 0;
  let totalIzz = 0;
  let totalIxy = 0;
  let totalIxz = 0;
  let totalIyz = 0;

  const componentInertias: ComponentInertia[] = [];
  let hasApproximatedPart = false;
  let hasInvalidPart = false;

  const comX = com.x;
  const comY = com.y;
  const comZ = com.z;

  for (const part of parts) {
    const rawMass = part.massKg ?? part.mass;
    if (rawMass === undefined || rawMass === null || !Number.isFinite(rawMass) || rawMass <= 0) {
      hasInvalidPart = true;
      warnings.push(`Component "${part.name}" (${part.id}) has invalid mass (${rawMass}); excluded from inertia tensor.`);
      continue;
    }

    const localResult = calculateLocalComponentInertia(part);
    if (localResult.isApproximated) {
      hasApproximatedPart = true;
    }
    warnings.push(...localResult.warnings);

    const rotation = part.rotation ?? [0, 0, 0];
    const orientedTensor = rotateInertiaTensor(localResult.tensor, rotation);

    const pos = part.position ?? [0, 0, 0];
    const dx = pos[0] - comX;
    const dy = pos[1] - comY;
    const dz = pos[2] - comZ;

    const transferredTensor = translateInertiaTensor(orientedTensor, rawMass, [dx, dy, dz]);

    componentInertias.push({
      partId: part.id,
      name: part.name,
      massKg: rawMass,
      localInertia: localResult.tensor,
      orientedInertia: orientedTensor,
      transferredInertia: transferredTensor,
      isApproximated: localResult.isApproximated,
      warnings: localResult.warnings,
    });

    // Accumulate into total assembly tensor
    totalIxx += transferredTensor[0][0];
    totalIxy += transferredTensor[0][1];
    totalIxz += transferredTensor[0][2];
    totalIyy += transferredTensor[1][1];
    totalIyz += transferredTensor[1][2];
    totalIzz += transferredTensor[2][2];
  }

  const tensor: InertiaMatrix3x3 = [
    [totalIxx, totalIxy, totalIxz],
    [totalIxy, totalIyy, totalIyz],
    [totalIxz, totalIyz, totalIzz],
  ];

  const principalMoments: PrincipalMomentsOfInertia = {
    ixx: totalIxx,
    iyy: totalIyy,
    izz: totalIzz,
  };

  const totalMass = com.totalMassKg;
  const radiiOfGyration: RadiiOfGyration = {
    kx: totalMass > 0 && totalIxx >= 0 ? Math.sqrt(totalIxx / totalMass) : 0,
    ky: totalMass > 0 && totalIyy >= 0 ? Math.sqrt(totalIyy / totalMass) : 0,
    kz: totalMass > 0 && totalIzz >= 0 ? Math.sqrt(totalIzz / totalMass) : 0,
  };

  let validity: CalculationValidity = "valid";
  if (com.validity === "invalid" || totalMass <= 0) {
    validity = "invalid";
  } else if (hasInvalidPart || hasApproximatedPart || com.validity === "marginal") {
    validity = "marginal";
  }

  return {
    totalMassKg: totalMass,
    centerOfMass: com,
    tensor,
    principalMoments,
    radiiOfGyration,
    componentInertias,
    validity,
    assumptions,
    warnings: Array.from(new Set(warnings)),
  };
}
