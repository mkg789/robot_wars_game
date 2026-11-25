import { describe, expect, it } from "vitest";
import type { CollisionContact } from "../types/collision.types";
import type {
  SimulationRobotConfig,
  SimulationState,
} from "../types/simulation.types";
import {
  bodyToWorldVelocity,
  computeEffectiveMassAlongAxis,
  computePositionalPenetrationCorrection,
  DEFAULT_COLLISION_RESTITUTION,
  DEFAULT_COLLISION_SOLVER_ITERATIONS,
  DEFAULT_CONTACT_FRICTION_COEFF,
  resolveArenaCollisions,
  resolveCollisionResponseConfig,
  validateCollisionResponseOptions,
  worldToBodyVelocity,
} from "./collisionResponse";
import { createInitialSimulationState } from "./drivetrainDynamics";

function createTestRobotConfig(
  overrides?: Partial<SimulationRobotConfig>
): SimulationRobotConfig {
  const totalMassKg = 10.0;
  const normalPerWheelN = (totalMassKg * 9.80665) / 2;

  return {
    totalMassKg,
    centerOfMass: { x: 0, y: 0.1, z: 0 },
    yawInertiaKgM2: 0.5,
    trackWidthM: 0.6,
    wheelbaseM: null,
    drivetrain: {
      type: "differential-2",
      drivenWheelCount: 2,
      leftSlotCount: 1,
      rightSlotCount: 1,
    },
    motors: [
      {
        motorId: "m-l",
        name: "Left Motor",
        side: "left",
        slotIndex: 0,
        stallTorqueNm: 1.5,
        noLoadRpm: 300,
        noLoadAngularVelocityRadPerSec: (300 * 2 * Math.PI) / 60,
        nominalVoltageV: 12,
        provenance: { source: "test", verified: true },
      },
      {
        motorId: "m-r",
        name: "Right Motor",
        side: "right",
        slotIndex: 0,
        stallTorqueNm: 1.5,
        noLoadRpm: 300,
        noLoadAngularVelocityRadPerSec: (300 * 2 * Math.PI) / 60,
        nominalVoltageV: 12,
        provenance: { source: "test", verified: true },
      },
    ],
    wheels: [
      {
        wheelId: "w-l",
        name: "Left Wheel",
        side: "left",
        slotIndex: 0,
        diameterM: 0.2,
        radiusM: 0.1,
        widthM: 0.05,
        staticFrictionCoeff: 0.85,
        normalLoadN: normalPerWheelN,
        provenance: { source: "test", verified: true },
      },
      {
        wheelId: "w-r",
        name: "Right Wheel",
        side: "right",
        slotIndex: 0,
        diameterM: 0.2,
        radiusM: 0.1,
        widthM: 0.05,
        staticFrictionCoeff: 0.85,
        normalLoadN: normalPerWheelN,
        provenance: { source: "test", verified: true },
      },
    ],
    battery: {
      batteryId: "bat-1",
      name: "3S LiPo",
      nominalVoltageV: 11.1,
      fullyChargedVoltageV: 12.6,
      cutoffVoltageV: 9.0,
      provenance: { source: "test", verified: true },
    },
    normalLoads: null,
    assumptions: [],
    validity: "valid",
    warnings: [],
    ...overrides,
  };
}

function createStateWithWorldVelocity(params: {
  x?: number;
  z?: number;
  heading?: number;
  worldVx?: number;
  worldVz?: number;
  yawRate?: number;
}): SimulationState {
  const heading = params.heading ?? 0;
  const bodyVel = worldToBodyVelocity(
    params.worldVx ?? 0,
    params.worldVz ?? 0,
    heading
  );
  const base = createInitialSimulationState({
    x: params.x ?? 0,
    z: params.z ?? 0,
    heading,
  });
  return {
    ...base,
    longitudinalVelocityMps: bodyVel.longitudinalMps,
    lateralVelocityMps: bodyVel.lateralMps,
    yawRateRadPerSec: params.yawRate ?? 0,
  };
}

describe("Phase 4.1.4: Planar Collision Response & Contact Resolution", () => {
  const config = createTestRobotConfig();

  describe("1. Configuration Defaults & Validation", () => {
    it("provides conservative defaults with explicit assumptions", () => {
      const resolved = resolveCollisionResponseConfig();
      expect(resolved.restitution).toBe(DEFAULT_COLLISION_RESTITUTION);
      expect(resolved.contactFrictionCoeff).toBe(DEFAULT_CONTACT_FRICTION_COEFF);
      expect(resolved.solverIterations).toBe(DEFAULT_COLLISION_SOLVER_ITERATIONS);
      expect(resolved.assumptions.length).toBeGreaterThanOrEqual(2);
    });

    it("rejects out-of-range or non-finite CollisionResponseOptions", () => {
      expect(validateCollisionResponseOptions({ restitution: -0.1 }).isValid).toBe(false);
      expect(validateCollisionResponseOptions({ restitution: 1.2 }).isValid).toBe(false);
      expect(validateCollisionResponseOptions({ contactFrictionCoeff: -0.5 }).isValid).toBe(false);
      expect(validateCollisionResponseOptions({ penetrationSlopM: -0.01 }).isValid).toBe(false);
      expect(validateCollisionResponseOptions({ penetrationCorrectionFraction: 1.5 }).isValid).toBe(false);
      expect(validateCollisionResponseOptions({ maxPenetrationCorrectionM: -1 }).isValid).toBe(false);
      expect(validateCollisionResponseOptions({ solverIterations: 0 }).isValid).toBe(false);
      expect(validateCollisionResponseOptions({ solverIterations: 2.5 }).isValid).toBe(false);
      expect(validateCollisionResponseOptions({ solverIterations: 100 }).isValid).toBe(false);
      expect(validateCollisionResponseOptions({ restitutionVelocityThresholdMps: -0.1 }).isValid).toBe(false);

      expect(() => resolveCollisionResponseConfig({ restitution: NaN })).toThrow(/Invalid CollisionResponseOptions/);
    });
  });

  describe("2. Normal Collision Response & Linear Momentum", () => {
    const northWallContact: CollisionContact = {
      barrierId: "wall-north",
      classification: "perimeter-wall",
      normal: { x: -1, z: 0 }, // points from +X wall into robot (-X)
      penetrationDepth: 0.0005, // within default 0.001 m slop
      contactPoint: { x: 5.0, z: 0 },
    };

    it("stops robot against wall on zero-restitution centered impact", () => {
      const state = createStateWithWorldVelocity({ x: 4.5, z: 0, worldVx: 2.0 });
      const res = resolveArenaCollisions(config, state, [northWallContact], {
        restitution: 0,
        contactFrictionCoeff: 0,
      });

      expect(res.hasCollisions).toBe(true);
      expect(res.contacts[0].wasApproaching).toBe(true);
      expect(res.state.longitudinalVelocityMps).toBeCloseTo(0, 6);
      expect(res.state.lateralVelocityMps).toBeCloseTo(0, 6);
      expect(res.state.yawRateRadPerSec).toBeCloseTo(0, 6);
      // Normal impulse J_n = M * Δv = 10 * 2.0 = 20 N·s
      expect(res.contacts[0].normalImpulseNs).toBeCloseTo(20.0, 5);
      expect(res.kineticEnergyAfterJ).toBeCloseTo(0, 6);
    });

    it("applies exact rebound velocity with non-zero restitution", () => {
      const state = createStateWithWorldVelocity({ x: 4.5, z: 0, worldVx: 2.0 });
      const res = resolveArenaCollisions(config, state, [northWallContact], {
        restitution: 0.5,
        contactFrictionCoeff: 0,
      });

      // v' = -e * v = -0.5 * 2.0 = -1.0 m/s
      expect(res.state.longitudinalVelocityMps).toBeCloseTo(-1.0, 6);
      // J_n = M * (1 + e) * v = 10 * 1.5 * 2.0 = 30 N·s
      expect(res.contacts[0].normalImpulseNs).toBeCloseTo(30.0, 5);
      // KE_before = 0.5 * 10 * 4 = 20 J, KE_after = 0.5 * 10 * 1 = 5 J
      expect(res.kineticEnergyBeforeJ).toBeCloseTo(20.0, 5);
      expect(res.kineticEnergyAfterJ).toBeCloseTo(5.0, 5);
      expect(res.kineticEnergyAfterJ).toBeLessThanOrEqual(res.kineticEnergyBeforeJ);
    });

    it("handles stationary contact against a wall with zero impulse", () => {
      const state = createStateWithWorldVelocity({ x: 4.5, z: 0, worldVx: 0 });
      const res = resolveArenaCollisions(config, state, [northWallContact], {
        restitution: 0.5,
      });

      expect(res.contacts[0].wasApproaching).toBe(false);
      expect(res.contacts[0].normalImpulseNs).toBe(0);
      expect(res.totalNormalImpulseNs).toBe(0);
      expect(res.state.longitudinalVelocityMps).toBe(0);
    });

    it("applies no normal impulse when robot is already separating from wall", () => {
      const state = createStateWithWorldVelocity({ x: 4.5, z: 0, worldVx: -1.5 });
      const res = resolveArenaCollisions(config, state, [northWallContact], {
        restitution: 0.8,
        contactFrictionCoeff: 0.5,
      });

      expect(res.contacts[0].wasApproaching).toBe(false);
      expect(res.contacts[0].initialNormalVelocityMps).toBeCloseTo(1.5, 6);
      expect(res.contacts[0].normalImpulseNs).toBe(0);
      expect(res.contacts[0].tangentialImpulseNs).toBe(0);
      expect(res.state.longitudinalVelocityMps).toBeCloseTo(-1.5, 6);
      expect(res.kineticEnergyAfterJ).toBeCloseTo(res.kineticEnergyBeforeJ, 6);
    });

    it("suppresses restitution below restitutionVelocityThresholdMps to avoid micro-bounce chatter", () => {
      const state = createStateWithWorldVelocity({ x: 4.5, z: 0, worldVx: 0.02 });
      const res = resolveArenaCollisions(config, state, [northWallContact], {
        restitution: 0.5,
        restitutionVelocityThresholdMps: 0.05,
      });

      // Approaching speed 0.02 < 0.05 -> settles to 0 instead of micro-bouncing
      expect(res.state.longitudinalVelocityMps).toBeCloseTo(0, 6);
    });

    it("resolves collisions along all four cardinal directions (+X, -X, +Z, -Z)", () => {
      const cases = [
        {
          label: "+X wall (normal -X)",
          normal: { x: -1, z: 0 },
          contactPoint: { x: 5.0, z: 0 },
          vx: 2.0,
          vz: 0,
          expectedVx: -1.0,
          expectedVz: 0,
        },
        {
          label: "-X wall (normal +X)",
          normal: { x: 1, z: 0 },
          contactPoint: { x: -5.0, z: 0 },
          vx: -2.0,
          vz: 0,
          expectedVx: 1.0,
          expectedVz: 0,
        },
        {
          label: "+Z wall (normal -Z)",
          normal: { x: 0, z: -1 },
          contactPoint: { x: 0, z: 5.0 },
          vx: 0,
          vz: 2.0,
          expectedVx: 0,
          expectedVz: -1.0,
        },
        {
          label: "-Z wall (normal +Z)",
          normal: { x: 0, z: 1 },
          contactPoint: { x: 0, z: -5.0 },
          vx: 0,
          vz: -2.0,
          expectedVx: 0,
          expectedVz: 1.0,
        },
      ];

      for (const c of cases) {
        const state = createStateWithWorldVelocity({
          x: 0,
          z: 0,
          heading: 0,
          worldVx: c.vx,
          worldVz: c.vz,
        });
        const contact: CollisionContact = {
          barrierId: c.label,
          classification: "perimeter-wall",
          normal: c.normal,
          penetrationDepth: 0,
          contactPoint: c.contactPoint,
        };
        const res = resolveArenaCollisions(config, state, [contact], {
          restitution: 0.5,
          contactFrictionCoeff: 0,
        });
        const worldVel = bodyToWorldVelocity(
          res.state.longitudinalVelocityMps,
          res.state.lateralVelocityMps,
          res.state.headingRadians
        );
        expect(worldVel.x).toBeCloseTo(c.expectedVx, 6);
        expect(worldVel.z).toBeCloseTo(c.expectedVz, 6);
      }
    });
  });

  describe("3. Angular Collision Response & Coordinate Sign Verification", () => {
    it("produces zero angular velocity change on centered normal impact", () => {
      const state = createStateWithWorldVelocity({
        x: 4.5,
        z: 0,
        heading: 0,
        worldVx: 2.0,
      });
      const contact: CollisionContact = {
        barrierId: "interior-center",
        classification: "interior-barrier",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0,
        contactPoint: { x: 5.0, z: 0 },
      };

      const res = resolveArenaCollisions(config, state, [contact], {
        restitution: 0.2,
        contactFrictionCoeff: 0,
      });

      expect(res.contacts[0].angularImpulseNms).toBeCloseTo(0, 6);
      expect(res.state.yawRateRadPerSec).toBeCloseTo(0, 6);
    });

    it("generates positive (CCW/+Z) yaw rate when front-left corner hits +X wall", () => {
      // Robot moving +X into +X wall (normal = (-1, 0)).
      // Front-left corner is at r = (+0.5, +0.3). Pushing it in -X turns robot CCW toward +Z (+omega).
      const state = createStateWithWorldVelocity({
        x: 4.5,
        z: 0,
        heading: 0,
        worldVx: 2.0,
      });
      const r = { x: 0.5, z: 0.3 };
      const contact: CollisionContact = {
        barrierId: "wall-north",
        classification: "perimeter-wall",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0,
        contactPoint: { x: 4.5 + r.x, z: 0 + r.z },
      };

      const effMass = computeEffectiveMassAlongAxis(
        config.totalMassKg,
        config.yawInertiaKgM2,
        r,
        contact.normal
      );
      // 1 / m_eff = 1/10 + (-0.3 * -1)^2 / 0.5 = 0.1 + 0.09 / 0.5 = 0.28 -> m_eff = 1/0.28
      expect(effMass).toBeCloseTo(1 / 0.28, 5);

      const res = resolveArenaCollisions(config, state, [contact], {
        restitution: 0,
        contactFrictionCoeff: 0,
      });

      // j_n = 2.0 / 0.28 = 7.142857 N·s
      // r x n = 0.5 * 0 - 0.3 * (-1) = +0.3
      // Δω = (7.142857 * 0.3) / 0.5 = +4.285714 rad/s
      expect(res.contacts[0].normalImpulseNs).toBeCloseTo(2.0 / 0.28, 5);
      expect(res.state.yawRateRadPerSec).toBeGreaterThan(0);
      expect(res.state.yawRateRadPerSec).toBeCloseTo((2.0 / 0.28) * 0.3 / 0.5, 5);
    });

    it("generates negative (CW/-Z) yaw rate when front-right corner hits +X wall", () => {
      const state = createStateWithWorldVelocity({
        x: 4.5,
        z: 0,
        heading: 0,
        worldVx: 2.0,
      });
      const contact: CollisionContact = {
        barrierId: "wall-north",
        classification: "perimeter-wall",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0,
        contactPoint: { x: 5.0, z: -0.3 }, // right side (-Z)
      };

      const res = resolveArenaCollisions(config, state, [contact], {
        restitution: 0,
        contactFrictionCoeff: 0,
      });

      expect(res.state.yawRateRadPerSec).toBeLessThan(0);
      expect(res.state.yawRateRadPerSec).toBeCloseTo(-(2.0 / 0.28) * 0.3 / 0.5, 5);
    });

    it("scales angular response inversely with yaw moment of inertia", () => {
      const lowInertia = createTestRobotConfig({ yawInertiaKgM2: 0.25 });
      const highInertia = createTestRobotConfig({ yawInertiaKgM2: 2.0 });

      const state = createStateWithWorldVelocity({ x: 0, z: 0, worldVx: 2.0 });
      const contact: CollisionContact = {
        barrierId: "pillar",
        classification: "interior-barrier",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0,
        contactPoint: { x: 0.4, z: 0.3 },
      };

      const resLow = resolveArenaCollisions(lowInertia, state, [contact], {
        restitution: 0.2,
        contactFrictionCoeff: 0,
      });
      const resHigh = resolveArenaCollisions(highInertia, state, [contact], {
        restitution: 0.2,
        contactFrictionCoeff: 0,
      });

      expect(Math.abs(resLow.state.yawRateRadPerSec)).toBeGreaterThan(
        Math.abs(resHigh.state.yawRateRadPerSec)
      );
      expect(resHigh.contacts[0].effectiveMassNormalKg).toBeGreaterThan(
        resLow.contacts[0].effectiveMassNormalKg
      );
    });
  });

  describe("4. Coulomb Tangential Friction", () => {
    const wallContact: CollisionContact = {
      barrierId: "wall-north",
      classification: "perimeter-wall",
      normal: { x: -1, z: 0 },
      penetrationDepth: 0,
      // Centered along Z, at front X = 0.5
      contactPoint: { x: 0.5, z: 0 },
    };

    it("leaves tangential velocity untouched when contactFrictionCoeff is zero", () => {
      const state = createStateWithWorldVelocity({
        x: 0,
        z: 0,
        worldVx: 2.0,
        worldVz: 3.0,
      });

      const res = resolveArenaCollisions(config, state, [wallContact], {
        restitution: 0,
        contactFrictionCoeff: 0,
      });

      expect(res.contacts[0].tangentialImpulseNs).toBe(0);
      const worldVel = bodyToWorldVelocity(
        res.state.longitudinalVelocityMps,
        res.state.lateralVelocityMps,
        res.state.headingRadians
      );
      expect(worldVel.x).toBeCloseTo(0, 6);
      expect(worldVel.z).toBeCloseTo(3.0, 6);
    });

    it("reduces tangential velocity within Coulomb cone |J_t| <= μ * J_n", () => {
      const state = createStateWithWorldVelocity({
        x: 0,
        z: 0,
        worldVx: 2.0,
        worldVz: 5.0,
      });
      const mu = 0.25;

      const res = resolveArenaCollisions(config, state, [wallContact], {
        restitution: 0,
        contactFrictionCoeff: mu,
      });

      const diag = res.contacts[0];
      expect(diag.wasFrictionSaturated).toBe(true);
      expect(Math.abs(diag.tangentialImpulseNs)).toBeCloseTo(mu * diag.normalImpulseNs, 5);
      expect(Math.abs(diag.tangentialImpulseNs)).toBeLessThanOrEqual(
        mu * diag.normalImpulseNs + 1e-9
      );

      const worldVel = bodyToWorldVelocity(
        res.state.longitudinalVelocityMps,
        res.state.lateralVelocityMps,
        res.state.headingRadians
      );
      // Tangential speed reduced from 5.0 m/s, still positive
      expect(worldVel.z).toBeGreaterThan(0);
      expect(worldVel.z).toBeLessThan(5.0);
      expect(res.kineticEnergyAfterJ).toBeLessThan(res.kineticEnergyBeforeJ);
    });

    it("halts tangential slip completely under high friction when inside Coulomb cone", () => {
      const state = createStateWithWorldVelocity({
        x: 0,
        z: 0,
        worldVx: 4.0,
        worldVz: 0.5,
      });

      const res = resolveArenaCollisions(config, state, [wallContact], {
        restitution: 0,
        contactFrictionCoeff: 0.9,
      });

      const diag = res.contacts[0];
      expect(diag.wasFrictionSaturated).toBe(false);
      expect(diag.finalTangentialVelocityMps).toBeCloseTo(0, 5);
      expect(Math.abs(diag.tangentialImpulseNs)).toBeLessThan(0.9 * diag.normalImpulseNs);
      expect(res.kineticEnergyAfterJ).toBeLessThanOrEqual(res.kineticEnergyBeforeJ);
    });
  });

  describe("5. Positional Penetration Correction", () => {
    it("corrects shallow penetration along normal without altering velocities", () => {
      const state = createStateWithWorldVelocity({
        x: 4.8,
        z: 0,
        worldVx: 0,
        worldVz: 0,
      });
      const contact: CollisionContact = {
        barrierId: "wall-north",
        classification: "perimeter-wall",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0.05,
        contactPoint: { x: 5.0, z: 0 },
      };

      const res = resolveArenaCollisions(config, state, [contact], {
        penetrationSlopM: 0.001,
        penetrationCorrectionFraction: 0.8,
        maxPenetrationCorrectionM: 0.1,
      });

      // Expected displacement = 0.8 * (0.05 - 0.001) = 0.0392 m along (-1, 0)
      expect(res.positionalCorrectionWorldM.x).toBeCloseTo(-0.0392, 6);
      expect(res.positionalCorrectionWorldM.z).toBeCloseTo(0, 6);
      expect(res.state.xMeters).toBeCloseTo(4.8 - 0.0392, 6);
      // Velocities strictly unaltered
      expect(res.state.longitudinalVelocityMps).toBe(0);
      expect(res.state.lateralVelocityMps).toBe(0);
      expect(res.state.yawRateRadPerSec).toBe(0);
    });

    it("clamps deep penetration correction to maxPenetrationCorrectionM", () => {
      const state = createStateWithWorldVelocity({ x: 4.9, z: 0, worldVx: 0 });
      const contact: CollisionContact = {
        barrierId: "wall-north",
        classification: "perimeter-wall",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0.6,
        contactPoint: { x: 5.0, z: 0 },
      };

      const res = resolveArenaCollisions(config, state, [contact], {
        penetrationSlopM: 0.001,
        penetrationCorrectionFraction: 0.8,
        maxPenetrationCorrectionM: 0.05,
      });

      expect(res.positionalCorrectionWorldM.x).toBeCloseTo(-0.05, 6);
      expect(res.state.xMeters).toBeCloseTo(4.85, 6);
    });

    it("skips positional correction when overlap is within penetrationSlopM", () => {
      const state = createStateWithWorldVelocity({ x: 4.5, z: 0, worldVx: 0 });
      const contact: CollisionContact = {
        barrierId: "wall-north",
        classification: "perimeter-wall",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0.0008,
        contactPoint: { x: 5.0, z: 0 },
      };

      const res = resolveArenaCollisions(config, state, [contact], {
        penetrationSlopM: 0.001,
      });

      expect(res.positionalCorrectionWorldM).toEqual({ x: 0, z: 0 });
      expect(res.state.xMeters).toBe(4.5);
    });

    it("prevents double-counting across parallel collinear contacts and cancels opposing contacts", () => {
      const resolvedCfg = resolveCollisionResponseConfig({
        penetrationSlopM: 0,
        penetrationCorrectionFraction: 0.8,
        maxPenetrationCorrectionM: 0.2,
      });

      const collinearA: CollisionContact = {
        barrierId: "b1",
        classification: "interior-barrier",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0.05,
        contactPoint: { x: 1, z: 0.2 },
      };
      const collinearB: CollisionContact = {
        barrierId: "b2",
        classification: "interior-barrier",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0.05,
        contactPoint: { x: 1, z: -0.2 },
      };

      const corrCollinear = computePositionalPenetrationCorrection(
        [collinearA, collinearB],
        resolvedCfg
      );
      // Should be 0.8 * 0.05 = 0.04, NOT 0.08
      expect(corrCollinear.x).toBeCloseTo(-0.04, 6);
      expect(corrCollinear.z).toBeCloseTo(0, 6);

      const opposingB: CollisionContact = {
        ...collinearB,
        normal: { x: 1, z: 0 },
      };
      const corrOpposing = computePositionalPenetrationCorrection(
        [collinearA, opposingB],
        resolvedCfg
      );
      expect(corrOpposing.x).toBeCloseTo(0, 6);
      expect(corrOpposing.z).toBeCloseTo(0, 6);
    });
  });

  describe("6. Multiple Contacts, Deterministic Ordering & Stability", () => {
    it("resolves simultaneous arena corner collision (North + West walls)", () => {
      const state = createStateWithWorldVelocity({
        x: 4.7,
        z: 4.7,
        heading: Math.PI / 4,
        worldVx: 2.0,
        worldVz: 2.0,
      });

      const northContact: CollisionContact = {
        barrierId: "perimeter-wall-north-x-pos",
        classification: "perimeter-wall",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0.04,
        contactPoint: { x: 5.0, z: 4.7 },
      };
      const westContact: CollisionContact = {
        barrierId: "perimeter-wall-west-z-pos",
        classification: "perimeter-wall",
        normal: { x: 0, z: -1 },
        penetrationDepth: 0.03,
        contactPoint: { x: 4.7, z: 5.0 },
      };

      const res = resolveArenaCollisions(config, state, [westContact, northContact], {
        restitution: 0.25,
        contactFrictionCoeff: 0.2,
      });

      expect(res.contactCount).toBe(2);
      // Sorted deterministically by barrierId: north before west
      expect(res.contacts[0].barrierId).toBe("perimeter-wall-north-x-pos");
      expect(res.contacts[1].barrierId).toBe("perimeter-wall-west-z-pos");

      const worldVel = bodyToWorldVelocity(
        res.state.longitudinalVelocityMps,
        res.state.lateralVelocityMps,
        res.state.headingRadians
      );
      // Rebounds inward away from both walls (-X and -Z)
      expect(worldVel.x).toBeLessThan(0);
      expect(worldVel.z).toBeLessThan(0);
      expect(res.state.xMeters).toBeLessThan(4.7);
      expect(res.state.zMeters).toBeLessThan(4.7);
      expect(res.kineticEnergyAfterJ).toBeLessThanOrEqual(res.kineticEnergyBeforeJ);
    });

    it("produces identical results regardless of input contact ordering", () => {
      const state = createStateWithWorldVelocity({
        x: 2.0,
        z: 1.0,
        heading: 0.4,
        worldVx: 1.5,
        worldVz: -1.0,
        yawRate: 0.5,
      });

      const c1: CollisionContact = {
        barrierId: "barrier-alpha",
        classification: "interior-barrier",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0.02,
        contactPoint: { x: 2.3, z: 1.2 },
      };
      const c2: CollisionContact = {
        barrierId: "barrier-beta",
        classification: "perimeter-wall",
        normal: { x: 0, z: 1 },
        penetrationDepth: 0.03,
        contactPoint: { x: 1.9, z: 0.7 },
      };

      const resOrder1 = resolveArenaCollisions(config, state, [c1, c2]);
      const resOrder2 = resolveArenaCollisions(config, state, [c2, c1]);

      expect(resOrder1.state).toEqual(resOrder2.state);
      expect(resOrder1.contacts).toEqual(resOrder2.contacts);
      expect(resOrder1.positionalCorrectionWorldM).toEqual(
        resOrder2.positionalCorrectionWorldM
      );
    });

    it("handles rotated robot orientation and angled impact accurately", () => {
      // Robot rotated 60° hitting North wall (-1, 0)
      const heading = Math.PI / 3;
      const state = createStateWithWorldVelocity({
        x: 4.5,
        z: 0,
        heading,
        worldVx: 2.0 * Math.cos(heading),
        worldVz: 2.0 * Math.sin(heading),
      });

      const contact: CollisionContact = {
        barrierId: "wall-north",
        classification: "perimeter-wall",
        normal: { x: -1, z: 0 },
        penetrationDepth: 0.02,
        contactPoint: { x: 4.9, z: 0.3 },
      };

      const res = resolveArenaCollisions(config, state, [contact], {
        restitution: 0.3,
        contactFrictionCoeff: 0.2,
      });

      const worldVel = bodyToWorldVelocity(
        res.state.longitudinalVelocityMps,
        res.state.lateralVelocityMps,
        res.state.headingRadians
      );
      // Center of mass X velocity is reduced, contact point rebounds along normal (+0.3 m/s),
      // and offset impact rotates robot CCW away from the wall.
      expect(worldVel.x).toBeLessThan(2.0 * Math.cos(heading));
      expect(res.contacts[0].finalNormalVelocityMps).toBeGreaterThan(0);
      expect(res.state.yawRateRadPerSec).toBeGreaterThan(0);
      expect(res.kineticEnergyAfterJ).toBeLessThanOrEqual(res.kineticEnergyBeforeJ);
    });
  });

  describe("7. Numerical Stability & Deterministic Failure Validation", () => {
    const validContact: CollisionContact = {
      barrierId: "wall",
      classification: "perimeter-wall",
      normal: { x: -1, z: 0 },
      penetrationDepth: 0.01,
      contactPoint: { x: 5.0, z: 0 },
    };

    it("returns unchanged state when contacts array is empty", () => {
      const state = createStateWithWorldVelocity({ x: 1, z: -1, worldVx: 2.5 });
      const res = resolveArenaCollisions(config, state, []);
      expect(res.hasCollisions).toBe(false);
      expect(res.contactCount).toBe(0);
      expect(res.state).toBe(state);
    });

    it("preserves immutability of input config, state, and contacts", () => {
      const state = createStateWithWorldVelocity({ x: 4.8, z: 0, worldVx: 2.0 });
      const contacts: CollisionContact[] = [{ ...validContact }];

      const cfgClone = JSON.parse(JSON.stringify(config));
      const stateClone = JSON.parse(JSON.stringify(state));
      const contactsClone = JSON.parse(JSON.stringify(contacts));

      resolveArenaCollisions(config, state, contacts);

      expect(config).toEqual(cfgClone);
      expect(state).toEqual(stateClone);
      expect(contacts).toEqual(contactsClone);
    });

    it("rejects invalid mass, invalid inertia, non-finite state, and degenerate contacts", () => {
      const state = createStateWithWorldVelocity({ x: 0, z: 0, worldVx: 1 });

      expect(() =>
        resolveArenaCollisions(createTestRobotConfig({ totalMassKg: 0 }), state, [validContact])
      ).toThrow(/totalMassKg/);

      expect(() =>
        resolveArenaCollisions(createTestRobotConfig({ yawInertiaKgM2: -0.5 }), state, [validContact])
      ).toThrow(/yawInertiaKgM2/);

      expect(() =>
        resolveArenaCollisions(config, { ...state, xMeters: Number.NaN }, [validContact])
      ).toThrow(/xMeters/);

      expect(() =>
        resolveArenaCollisions(config, { ...state, yawRateRadPerSec: Infinity }, [validContact])
      ).toThrow(/yawRateRadPerSec/);

      expect(() =>
        resolveArenaCollisions(config, state, [
          { ...validContact, normal: { x: 0, z: 0 } },
        ])
      ).toThrow(/Degenerate collision normal/);

      expect(() =>
        resolveArenaCollisions(config, state, [
          { ...validContact, penetrationDepth: -0.05 },
        ])
      ).toThrow(/penetrationDepth/);

      expect(() =>
        resolveArenaCollisions(config, state, [
          { ...validContact, contactPoint: { x: Number.NaN, z: 0 } },
        ])
      ).toThrow(/contactPoint/);
    });
  });
});
