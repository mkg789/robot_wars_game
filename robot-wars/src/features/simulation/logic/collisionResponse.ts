/**
 * Pure Planar Collision Response & Contact Resolution Engine for Robot Wars (Phase 4.1.4).
 *
 * Implements a deliberately limited planar rigid-body contact solver for a single robot
 * colliding against static rectangular arena geometry (perimeter walls and interior barriers).
 *
 * Physics & Conventions:
 * - Planar rigid body in the X-Z ground plane with mass M and yaw moment of inertia I_yaw.
 * - Static barriers have infinite mass and zero velocity.
 * - Planar pose origin (xMeters, zMeters) is treated as the rigid-body center of mass
 *   consistent with drivetrainDynamics.ts and collisionModel.ts.
 * - Heading θ = 0 points along +X; positive θ and positive yawRateRadPerSec turn CCW toward +Z.
 * - For 2D vectors a = (ax, az), b = (bx, bz) in the X-Z plane:
 *   - 2D scalar cross product: a x b = ax * bz - az * bx
 *   - Rotational velocity at offset r = (rx, rz): v_rot = (-ω * rz, +ω * rx)
 *   - Angular impulse from linear impulse J = (Jx, Jz) at r: J_tau = rx * Jz - rz * Jx
 * - Normal convention from Phase 4.1.3: normal points FROM barrier INTO robot.
 *
 * Multi-Contact & Limitations:
 * - Uses bounded Projected Gauss-Seidel (sequential impulse) iteration with accumulated
 *   normal (>= 0) and Coulomb tangential (|J_t| <= μ * J_n) impulse clamping.
 * - Contacts are sorted deterministically by barrierId (with geometric tie-breakers).
 * - Positional penetration correction uses weighted Jacobi projection with slop and
 *   maximum displacement clamping; it never modifies velocity as a substitute for geometry.
 * - Barrier-contact friction is an assumed configurable parameter separate from Phase 4.1.1
 *   wheel-ground surface friction (barrier-specific materials are not yet modeled).
 * - Bounded solver assumes small simultaneous contact counts (typically 1-3 static contacts);
 *   extreme wedge configurations with restitution > 0 use Newton's kinematic restitution law.
 *
 * Completely decoupled from SAT collision detection, React, Three.js, DOM, and UI rendering.
 */

import type { CollisionContact, Vector2D } from "../types/collision.types";
import type {
  CollisionResponseOptions,
  CollisionResponseResult,
  CollisionResponseValidationResult,
  ContactResolutionDiagnostic,
  ResolvedCollisionResponseConfig,
} from "../types/collisionResponse.types";
import type {
  SimulationAssumption,
  SimulationRobotConfig,
  SimulationState,
} from "../types/simulation.types";

/**
 * Default restitution coefficient for robot-barrier impacts.
 * Conservative simulation assumption representing damped metallic/polymer chassis impacts.
 * NOT a verified physical material constant.
 */
export const DEFAULT_COLLISION_RESTITUTION = 0.2;

/**
 * Default Coulomb-style friction coefficient for robot-barrier wall contact.
 * Conservative simulation assumption separate from arena ground surface friction.
 * NOT a verified physical material constant.
 */
export const DEFAULT_CONTACT_FRICTION_COEFF = 0.3;

/**
 * Default positional penetration slop tolerance in meters (1 mm).
 */
export const DEFAULT_PENETRATION_SLOP_M = 0.001;

/**
 * Default positional penetration correction fraction per step (80%).
 */
export const DEFAULT_PENETRATION_CORRECTION_FRACTION = 0.8;

/**
 * Default maximum positional correction displacement per step in meters (10 cm).
 */
export const DEFAULT_MAX_PENETRATION_CORRECTION_M = 0.1;

/**
 * Default bounded solver iteration count for multi-contact sequential impulse resolution.
 */
export const DEFAULT_COLLISION_SOLVER_ITERATIONS = 4;

/**
 * Maximum permitted bounded solver iterations.
 */
export const MAX_COLLISION_SOLVER_ITERATIONS = 64;

/**
 * Default minimum approaching normal speed (m/s) required to apply restitution.
 * Set conservatively above single-step drivetrain acceleration Δv (~0.07–0.10 m/s at 120 Hz)
 * so sustained throttle against a barrier settles cleanly without micro-bounce chatter.
 */
export const DEFAULT_RESTITUTION_VELOCITY_THRESHOLD_MPS = 0.2;

const VELOCITY_EPSILON_MPS = 1e-9;
const DEGENERATE_NORMAL_EPSILON = 1e-9;
const INVERSE_MASS_EPSILON = 1e-12;

/**
 * Validates CollisionResponseOptions parameters.
 */
export function validateCollisionResponseOptions(
  options?: CollisionResponseOptions
): CollisionResponseValidationResult {
  const errors: string[] = [];

  if (options === undefined) {
    return { isValid: true, errors: [] };
  }

  if (typeof options !== "object" || options === null) {
    return {
      isValid: false,
      errors: ["CollisionResponseOptions must be an object when provided."],
    };
  }

  if (options.restitution !== undefined) {
    if (
      typeof options.restitution !== "number" ||
      !Number.isFinite(options.restitution) ||
      options.restitution < 0 ||
      options.restitution > 1
    ) {
      errors.push(
        `Invalid restitution: must be a finite number in [0, 1], received: ${options.restitution}`
      );
    }
  }

  if (options.contactFrictionCoeff !== undefined) {
    if (
      typeof options.contactFrictionCoeff !== "number" ||
      !Number.isFinite(options.contactFrictionCoeff) ||
      options.contactFrictionCoeff < 0
    ) {
      errors.push(
        `Invalid contactFrictionCoeff: must be a non-negative finite number, received: ${options.contactFrictionCoeff}`
      );
    }
  }

  if (options.penetrationSlopM !== undefined) {
    if (
      typeof options.penetrationSlopM !== "number" ||
      !Number.isFinite(options.penetrationSlopM) ||
      options.penetrationSlopM < 0
    ) {
      errors.push(
        `Invalid penetrationSlopM: must be a non-negative finite number, received: ${options.penetrationSlopM}`
      );
    }
  }

  if (options.penetrationCorrectionFraction !== undefined) {
    if (
      typeof options.penetrationCorrectionFraction !== "number" ||
      !Number.isFinite(options.penetrationCorrectionFraction) ||
      options.penetrationCorrectionFraction < 0 ||
      options.penetrationCorrectionFraction > 1
    ) {
      errors.push(
        `Invalid penetrationCorrectionFraction: must be a finite number in [0, 1], received: ${options.penetrationCorrectionFraction}`
      );
    }
  }

  if (options.maxPenetrationCorrectionM !== undefined) {
    if (
      typeof options.maxPenetrationCorrectionM !== "number" ||
      !Number.isFinite(options.maxPenetrationCorrectionM) ||
      options.maxPenetrationCorrectionM < 0
    ) {
      errors.push(
        `Invalid maxPenetrationCorrectionM: must be a non-negative finite number, received: ${options.maxPenetrationCorrectionM}`
      );
    }
  }

  if (options.solverIterations !== undefined) {
    if (
      typeof options.solverIterations !== "number" ||
      !Number.isInteger(options.solverIterations) ||
      options.solverIterations < 1 ||
      options.solverIterations > MAX_COLLISION_SOLVER_ITERATIONS
    ) {
      errors.push(
        `Invalid solverIterations: must be an integer in [1, ${MAX_COLLISION_SOLVER_ITERATIONS}], received: ${options.solverIterations}`
      );
    }
  }

  if (options.restitutionVelocityThresholdMps !== undefined) {
    if (
      typeof options.restitutionVelocityThresholdMps !== "number" ||
      !Number.isFinite(options.restitutionVelocityThresholdMps) ||
      options.restitutionVelocityThresholdMps < 0
    ) {
      errors.push(
        `Invalid restitutionVelocityThresholdMps: must be a non-negative finite number, received: ${options.restitutionVelocityThresholdMps}`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Resolves and validates CollisionResponseOptions into an immutable configuration with assumptions.
 */
export function resolveCollisionResponseConfig(
  options?: CollisionResponseOptions
): ResolvedCollisionResponseConfig {
  const validation = validateCollisionResponseOptions(options);
  if (!validation.isValid) {
    throw new Error(`Invalid CollisionResponseOptions: ${validation.errors.join("; ")}`);
  }

  const restitution = options?.restitution ?? DEFAULT_COLLISION_RESTITUTION;
  const contactFrictionCoeff =
    options?.contactFrictionCoeff ?? DEFAULT_CONTACT_FRICTION_COEFF;
  const penetrationSlopM = options?.penetrationSlopM ?? DEFAULT_PENETRATION_SLOP_M;
  const penetrationCorrectionFraction =
    options?.penetrationCorrectionFraction ?? DEFAULT_PENETRATION_CORRECTION_FRACTION;
  const maxPenetrationCorrectionM =
    options?.maxPenetrationCorrectionM ?? DEFAULT_MAX_PENETRATION_CORRECTION_M;
  const solverIterations =
    options?.solverIterations ?? DEFAULT_COLLISION_SOLVER_ITERATIONS;
  const restitutionVelocityThresholdMps =
    options?.restitutionVelocityThresholdMps ?? DEFAULT_RESTITUTION_VELOCITY_THRESHOLD_MPS;

  const assumptions: SimulationAssumption[] = [];

  if (options?.restitution === undefined) {
    assumptions.push({
      id: "collision-default-restitution",
      parameter: "collisionResponse.restitution",
      value: DEFAULT_COLLISION_RESTITUTION,
      unit: "dimensionless",
      source: "standard-default",
      description:
        "Assumed low-to-moderate coefficient of restitution (0.2) for damped chassis-to-barrier impacts; not a verified material property.",
    });
  }

  if (options?.contactFrictionCoeff === undefined) {
    assumptions.push({
      id: "collision-default-contact-friction",
      parameter: "collisionResponse.contactFrictionCoeff",
      value: DEFAULT_CONTACT_FRICTION_COEFF,
      unit: "dimensionless",
      source: "standard-default",
      description:
        "Assumed Coulomb contact friction coefficient (0.3) for barrier scraping, maintained independently of ground surface friction.",
    });
  }

  return {
    restitution,
    contactFrictionCoeff,
    penetrationSlopM,
    penetrationCorrectionFraction,
    maxPenetrationCorrectionM,
    solverIterations,
    restitutionVelocityThresholdMps,
    assumptions,
  };
}

/**
 * Converts body-fixed planar velocities (longitudinal +X_body, lateral +Z_body) to world X-Z velocity.
 */
export function bodyToWorldVelocity(
  longitudinalMps: number,
  lateralMps: number,
  headingRadians: number
): Vector2D {
  const cos = Math.cos(headingRadians);
  const sin = Math.sin(headingRadians);
  return {
    x: longitudinalMps * cos - lateralMps * sin,
    z: longitudinalMps * sin + lateralMps * cos,
  };
}

/**
 * Converts world X-Z planar velocity to body-fixed longitudinal (+X_body) and lateral (+Z_body) velocities.
 */
export function worldToBodyVelocity(
  worldVxMps: number,
  worldVzMps: number,
  headingRadians: number
): { readonly longitudinalMps: number; readonly lateralMps: number } {
  const cos = Math.cos(headingRadians);
  const sin = Math.sin(headingRadians);
  return {
    longitudinalMps: worldVxMps * cos + worldVzMps * sin,
    lateralMps: -worldVxMps * sin + worldVzMps * cos,
  };
}

/**
 * 2D scalar cross product in the X-Z plane: a x b = ax * bz - az * bx.
 * Consistent with heading θ = 0 along +X and positive yaw turning CCW toward +Z.
 */
export function cross2D(a: Vector2D, b: Vector2D): number {
  return a.x * b.z - a.z * b.x;
}

/**
 * Computes world-space linear velocity of a point on the robot at offset r from robot center.
 * v_point = v_center + (-ω * r_z, +ω * r_x)
 */
export function computeContactPointVelocity(
  linearVelocityWorld: Vector2D,
  yawRateRadPerSec: number,
  relativeContactOffset: Vector2D
): Vector2D {
  return {
    x: linearVelocityWorld.x - yawRateRadPerSec * relativeContactOffset.z,
    z: linearVelocityWorld.z + yawRateRadPerSec * relativeContactOffset.x,
  };
}

/**
 * Computes effective rigid-body mass along a unit axis at a contact offset r:
 * 1 / m_eff = 1 / M + (r x axis)^2 / I_yaw
 */
export function computeEffectiveMassAlongAxis(
  massKg: number,
  yawInertiaKgM2: number,
  relativeContactOffset: Vector2D,
  axis: Vector2D
): number {
  if (!Number.isFinite(massKg) || massKg <= 0) {
    throw new Error(`Invalid massKg: must be a positive finite number, received: ${massKg}`);
  }
  if (!Number.isFinite(yawInertiaKgM2) || yawInertiaKgM2 <= 0) {
    throw new Error(
      `Invalid yawInertiaKgM2: must be a positive finite number, received: ${yawInertiaKgM2}`
    );
  }

  const rCrossAxis = cross2D(relativeContactOffset, axis);
  const invEffMass = 1 / massKg + (rCrossAxis * rCrossAxis) / yawInertiaKgM2;
  if (!Number.isFinite(invEffMass) || invEffMass <= INVERSE_MASS_EPSILON) {
    return 0;
  }
  return 1 / invEffMass;
}

function assertValidRobotParameters(config: SimulationRobotConfig): void {
  if (!config || typeof config !== "object") {
    throw new Error("Invalid robot configuration: config must be a non-null object.");
  }
  if (!Number.isFinite(config.totalMassKg) || config.totalMassKg <= 0) {
    throw new Error(
      `Invalid robot configuration: totalMassKg must be a positive finite number, received: ${config.totalMassKg}`
    );
  }
  if (!Number.isFinite(config.yawInertiaKgM2) || config.yawInertiaKgM2 <= 0) {
    throw new Error(
      `Invalid robot configuration: yawInertiaKgM2 must be a positive finite number, received: ${config.yawInertiaKgM2}`
    );
  }
}

function assertFiniteSimulationState(state: SimulationState): void {
  if (!state || typeof state !== "object") {
    throw new Error("Invalid simulation state: state must be a non-null object.");
  }
  const numericFields: readonly [string, number][] = [
    ["xMeters", state.xMeters],
    ["zMeters", state.zMeters],
    ["headingRadians", state.headingRadians],
    ["longitudinalVelocityMps", state.longitudinalVelocityMps],
    ["lateralVelocityMps", state.lateralVelocityMps],
    ["yawRateRadPerSec", state.yawRateRadPerSec],
  ];
  for (const [name, value] of numericFields) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Invalid simulation state: "${name}" must be a finite number, received: ${value}`
      );
    }
  }
}

interface ValidatedNormalizedContact {
  readonly original: CollisionContact;
  readonly normal: Vector2D;
  readonly tangent: Vector2D;
  readonly contactPoint: Vector2D;
  readonly penetrationDepth: number;
}

function validateAndNormalizeContacts(
  contacts: readonly CollisionContact[]
): ValidatedNormalizedContact[] {
  if (!Array.isArray(contacts)) {
    throw new Error("Invalid collision contacts: contacts must be an array.");
  }

  const normalized: ValidatedNormalizedContact[] = [];

  for (const contact of contacts) {
    if (!contact || typeof contact !== "object") {
      throw new Error("Invalid collision contact: contact must be a non-null object.");
    }
    if (typeof contact.barrierId !== "string" || contact.barrierId.length === 0) {
      throw new Error("Invalid collision contact: barrierId must be a non-empty string.");
    }
    if (
      !contact.contactPoint ||
      !Number.isFinite(contact.contactPoint.x) ||
      !Number.isFinite(contact.contactPoint.z)
    ) {
      throw new Error(
        `Invalid collision contact (${contact.barrierId}): contactPoint coordinates must be finite numbers.`
      );
    }
    if (
      !contact.normal ||
      !Number.isFinite(contact.normal.x) ||
      !Number.isFinite(contact.normal.z)
    ) {
      throw new Error(
        `Invalid collision contact (${contact.barrierId}): normal components must be finite numbers.`
      );
    }
    if (!Number.isFinite(contact.penetrationDepth) || contact.penetrationDepth < 0) {
      throw new Error(
        `Invalid collision contact (${contact.barrierId}): penetrationDepth must be a non-negative finite number, received: ${contact.penetrationDepth}`
      );
    }

    const normalLen = Math.hypot(contact.normal.x, contact.normal.z);
    if (!Number.isFinite(normalLen) || normalLen < DEGENERATE_NORMAL_EPSILON) {
      throw new Error(
        `Degenerate collision normal for barrier "${contact.barrierId}": vector length ${normalLen} is near zero.`
      );
    }

    const nx = contact.normal.x / normalLen;
    const nz = contact.normal.z / normalLen;

    normalized.push({
      original: contact,
      normal: { x: nx, z: nz },
      tangent: { x: -nz, z: nx },
      contactPoint: { x: contact.contactPoint.x, z: contact.contactPoint.z },
      penetrationDepth: contact.penetrationDepth,
    });
  }

  // Deterministic contact ordering: primary by barrierId, secondary by geometry
  normalized.sort((a, b) => {
    const idCmp = a.original.barrierId.localeCompare(b.original.barrierId);
    if (idCmp !== 0) return idCmp;
    if (a.normal.x !== b.normal.x) return a.normal.x - b.normal.x;
    if (a.normal.z !== b.normal.z) return a.normal.z - b.normal.z;
    if (a.contactPoint.x !== b.contactPoint.x) return a.contactPoint.x - b.contactPoint.x;
    return a.contactPoint.z - b.contactPoint.z;
  });

  return normalized;
}

/**
 * Computes pure geometric positional penetration correction in world X-Z coordinates.
 *
 * Uses weighted Jacobi projection:
 * - Prevents double-counting across parallel/collinear contacts by dividing by aligned-normal weight.
 * - Preserves exact symmetry for opposing contacts (zero oscillation).
 * - Applies slop tolerance, correction fraction, and maximum single-step displacement clamp.
 * - Never modifies linear or angular velocities.
 */
export function computePositionalPenetrationCorrection(
  contacts: readonly CollisionContact[],
  config: ResolvedCollisionResponseConfig
): Vector2D {
  const normalized = validateAndNormalizeContacts(contacts);
  return computePositionalCorrectionFromNormalized(normalized, config);
}

function computePositionalCorrectionFromNormalized(
  contacts: readonly ValidatedNormalizedContact[],
  config: ResolvedCollisionResponseConfig
): Vector2D {
  if (
    contacts.length === 0 ||
    config.penetrationCorrectionFraction <= 0 ||
    config.maxPenetrationCorrectionM <= 0
  ) {
    return { x: 0, z: 0 };
  }

  let dx = 0;
  let dz = 0;

  for (let i = 0; i < contacts.length; i++) {
    const ci = contacts[i];
    const excessDepth = Math.max(0, ci.penetrationDepth - config.penetrationSlopM);
    if (excessDepth <= 0) {
      continue;
    }

    // Aligned-normal weight >= 1 prevents double-counting when multiple barriers share a normal
    let alignedWeight = 0;
    for (let j = 0; j < contacts.length; j++) {
      const cj = contacts[j];
      const dot = ci.normal.x * cj.normal.x + ci.normal.z * cj.normal.z;
      if (dot > 0) {
        alignedWeight += dot;
      }
    }

    const weight = Math.max(1, alignedWeight);
    const displacement = (config.penetrationCorrectionFraction * excessDepth) / weight;
    dx += displacement * ci.normal.x;
    dz += displacement * ci.normal.z;
  }

  const totalMag = Math.hypot(dx, dz);
  if (totalMag > config.maxPenetrationCorrectionM && totalMag > DEGENERATE_NORMAL_EPSILON) {
    const scale = config.maxPenetrationCorrectionM / totalMag;
    dx *= scale;
    dz *= scale;
  }

  return { x: dx, z: dz };
}

function computePlanarKineticEnergy(
  massKg: number,
  yawInertiaKgM2: number,
  worldVx: number,
  worldVz: number,
  yawRate: number
): number {
  return (
    0.5 * massKg * (worldVx * worldVx + worldVz * worldVz) +
    0.5 * yawInertiaKgM2 * yawRate * yawRate
  );
}

/**
 * Resolves detected static arena collisions against a planar rigid-body robot state.
 *
 * Performs:
 * 1. Parameter, state, and contact geometry validation.
 * 2. Deterministic contact sorting by barrierId.
 * 3. Bounded Projected Gauss-Seidel (sequential impulse) resolution for normal restitution
 *    and Coulomb-clamped tangential friction with angular inertia coupling.
 * 4. Purely geometric positional penetration correction (no velocity injection).
 * 5. Conversion of updated world velocities back into canonical body-fixed SimulationState.
 *
 * Pure and immutable: never mutates input config, state, or contacts.
 */
export function resolveArenaCollisions(
  config: SimulationRobotConfig,
  currentState: SimulationState,
  contacts: readonly CollisionContact[],
  options?: CollisionResponseOptions
): CollisionResponseResult {
  assertValidRobotParameters(config);
  assertFiniteSimulationState(currentState);
  const resolvedConfig = resolveCollisionResponseConfig(options);
  const sortedContacts = validateAndNormalizeContacts(contacts);

  const massKg = config.totalMassKg;
  const yawInertiaKgM2 = config.yawInertiaKgM2;
  const invMass = 1 / massKg;
  const invInertia = 1 / yawInertiaKgM2;

  const initialWorldVel = bodyToWorldVelocity(
    currentState.longitudinalVelocityMps,
    currentState.lateralVelocityMps,
    currentState.headingRadians
  );
  let vx = initialWorldVel.x;
  let vz = initialWorldVel.z;
  let omega = currentState.yawRateRadPerSec;

  const kineticEnergyBeforeJ = computePlanarKineticEnergy(
    massKg,
    yawInertiaKgM2,
    vx,
    vz,
    omega
  );

  if (sortedContacts.length === 0) {
    return {
      state: currentState,
      hasCollisions: false,
      contactCount: 0,
      solverIterationsExecuted: 0,
      totalNormalImpulseNs: 0,
      totalTangentialImpulseNs: 0,
      positionalCorrectionWorldM: { x: 0, z: 0 },
      kineticEnergyBeforeJ,
      kineticEnergyAfterJ: kineticEnergyBeforeJ,
      contacts: [],
      resolvedConfig,
    };
  }

  interface ContactSolverWorkspace {
    readonly contact: ValidatedNormalizedContact;
    readonly r: Vector2D;
    readonly rCrossN: number;
    readonly rCrossT: number;
    readonly invEffMassN: number;
    readonly invEffMassT: number;
    readonly effMassN: number;
    readonly effMassT: number;
    readonly initialVn: number;
    readonly initialVt: number;
    readonly targetVn: number;
    readonly wasApproaching: boolean;
    accumulatedNormalImpulse: number;
    accumulatedTangentImpulse: number;
  }

  const workspaces: ContactSolverWorkspace[] = sortedContacts.map((c) => {
    const r: Vector2D = {
      x: c.contactPoint.x - currentState.xMeters,
      z: c.contactPoint.z - currentState.zMeters,
    };
    const rCrossN = cross2D(r, c.normal);
    const rCrossT = cross2D(r, c.tangent);
    const invEffMassN = invMass + rCrossN * rCrossN * invInertia;
    const invEffMassT = invMass + rCrossT * rCrossT * invInertia;

    const vRel = computeContactPointVelocity({ x: vx, z: vz }, omega, r);
    const initialVn = vRel.x * c.normal.x + vRel.z * c.normal.z;
    const initialVt = vRel.x * c.tangent.x + vRel.z * c.tangent.z;

    const isApproaching = initialVn < -VELOCITY_EPSILON_MPS;
    const effectiveRestitution =
      isApproaching && -initialVn > resolvedConfig.restitutionVelocityThresholdMps
        ? resolvedConfig.restitution
        : 0;
    const targetVn = isApproaching ? -effectiveRestitution * initialVn : 0;

    return {
      contact: c,
      r,
      rCrossN,
      rCrossT,
      invEffMassN,
      invEffMassT,
      effMassN: invEffMassN > INVERSE_MASS_EPSILON ? 1 / invEffMassN : 0,
      effMassT: invEffMassT > INVERSE_MASS_EPSILON ? 1 / invEffMassT : 0,
      initialVn,
      initialVt,
      targetVn,
      wasApproaching: isApproaching,
      accumulatedNormalImpulse: 0,
      accumulatedTangentImpulse: 0,
    };
  });

  // Bounded Projected Gauss-Seidel (sequential impulse) solver loop
  const iterations = resolvedConfig.solverIterations;
  for (let iter = 0; iter < iterations; iter++) {
    for (const ws of workspaces) {
      const { normal, tangent } = ws.contact;

      // 1. Normal impulse resolution
      if (ws.invEffMassN > INVERSE_MASS_EPSILON) {
        const vRelN = computeContactPointVelocity({ x: vx, z: vz }, omega, ws.r);
        const vn = vRelN.x * normal.x + vRelN.z * normal.z;

        // Only apply normal impulse when approaching target normal velocity
        const deltaJn = (ws.targetVn - vn) / ws.invEffMassN;
        const prevJn = ws.accumulatedNormalImpulse;
        const nextJn = Math.max(0, prevJn + deltaJn);
        const appliedJn = nextJn - prevJn;

        if (Math.abs(appliedJn) > 0) {
          ws.accumulatedNormalImpulse = nextJn;
          vx += appliedJn * normal.x * invMass;
          vz += appliedJn * normal.z * invMass;
          omega += appliedJn * ws.rCrossN * invInertia;
        }
      }

      // 2. Tangential Coulomb friction impulse resolution (evaluated after normal update)
      if (
        ws.invEffMassT > INVERSE_MASS_EPSILON &&
        ws.accumulatedNormalImpulse > 0 &&
        resolvedConfig.contactFrictionCoeff > 0
      ) {
        const vRelT = computeContactPointVelocity({ x: vx, z: vz }, omega, ws.r);
        const vt = vRelT.x * tangent.x + vRelT.z * tangent.z;

        if (Math.abs(vt) > VELOCITY_EPSILON_MPS || ws.accumulatedTangentImpulse !== 0) {
          const deltaJt = -vt / ws.invEffMassT;
          const maxFriction =
            resolvedConfig.contactFrictionCoeff * ws.accumulatedNormalImpulse;
          const prevJt = ws.accumulatedTangentImpulse;
          const nextJt = Math.max(-maxFriction, Math.min(maxFriction, prevJt + deltaJt));
          const appliedJt = nextJt - prevJt;

          if (Math.abs(appliedJt) > 0) {
            ws.accumulatedTangentImpulse = nextJt;
            vx += appliedJt * tangent.x * invMass;
            vz += appliedJt * tangent.z * invMass;
            omega += appliedJt * ws.rCrossT * invInertia;
          }
        }
      }
    }
  }

  // Clamp near-zero residual velocity noise to exact 0
  if (Math.abs(vx) < 1e-12) vx = 0;
  if (Math.abs(vz) < 1e-12) vz = 0;
  if (Math.abs(omega) < 1e-12) omega = 0;

  // 3. Pure positional penetration correction (never alters velocity)
  const positionalCorrectionWorldM = computePositionalCorrectionFromNormalized(
    sortedContacts,
    resolvedConfig
  );

  const correctedX = currentState.xMeters + positionalCorrectionWorldM.x;
  const correctedZ = currentState.zMeters + positionalCorrectionWorldM.z;

  const updatedBodyVel = worldToBodyVelocity(vx, vz, currentState.headingRadians);

  const updatedState: SimulationState = {
    ...currentState,
    xMeters: correctedX,
    zMeters: correctedZ,
    longitudinalVelocityMps:
      Math.abs(updatedBodyVel.longitudinalMps) < 1e-12 ? 0 : updatedBodyVel.longitudinalMps,
    lateralVelocityMps:
      Math.abs(updatedBodyVel.lateralMps) < 1e-12 ? 0 : updatedBodyVel.lateralMps,
    yawRateRadPerSec: omega,
  };

  let totalNormalImpulseNs = 0;
  let totalTangentialImpulseNs = 0;

  const contactDiagnostics: ContactResolutionDiagnostic[] = workspaces.map((ws) => {
    const { normal, tangent, contactPoint, penetrationDepth, original } = ws.contact;
    const vRelFinal = computeContactPointVelocity({ x: vx, z: vz }, omega, ws.r);
    const finalVn = vRelFinal.x * normal.x + vRelFinal.z * normal.z;
    const finalVt = vRelFinal.x * tangent.x + vRelFinal.z * tangent.z;

    const jn = ws.accumulatedNormalImpulse;
    const jt = ws.accumulatedTangentImpulse;
    const angularImpulseNms = jn * ws.rCrossN + jt * ws.rCrossT;
    const maxFriction = resolvedConfig.contactFrictionCoeff * jn;

    totalNormalImpulseNs += jn;
    totalTangentialImpulseNs += Math.abs(jt);

    return {
      barrierId: original.barrierId,
      normal,
      contactPoint,
      penetrationDepthM: penetrationDepth,
      initialNormalVelocityMps: ws.initialVn,
      initialTangentialVelocityMps: ws.initialVt,
      finalNormalVelocityMps: finalVn,
      finalTangentialVelocityMps: finalVt,
      effectiveMassNormalKg: ws.effMassN,
      effectiveMassTangentKg: ws.effMassT,
      normalImpulseNs: jn,
      tangentialImpulseNs: jt,
      angularImpulseNms,
      wasApproaching: ws.wasApproaching,
      wasFrictionSaturated:
        jn > 0 &&
        resolvedConfig.contactFrictionCoeff > 0 &&
        Math.abs(jt) >= maxFriction - 1e-9,
    };
  });

  const kineticEnergyAfterJ = computePlanarKineticEnergy(
    massKg,
    yawInertiaKgM2,
    vx,
    vz,
    omega
  );

  return {
    state: updatedState,
    hasCollisions: true,
    contactCount: sortedContacts.length,
    solverIterationsExecuted: iterations,
    totalNormalImpulseNs,
    totalTangentialImpulseNs,
    positionalCorrectionWorldM,
    kineticEnergyBeforeJ,
    kineticEnergyAfterJ,
    contacts: contactDiagnostics,
    resolvedConfig,
  };
}
