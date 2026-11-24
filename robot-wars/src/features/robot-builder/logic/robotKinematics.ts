/**
 * Pure calculation engine for theoretical robot kinematics and performance metrics.
 *
 * Consumes robot assembly parts, connections, drivetrain configuration,
 * and canonical engineering specifications to derive analytical performance metrics.
 *
 * NOTE: This is an analytical engineering evaluation layer, NOT a dynamic physics simulation.
 * All calculations are deterministic, zero-dependency, and isolated from Three.js and React.
 */

import type {
  DrivetrainConfiguration,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";
import {
  resolveMotorEngineeringSpec,
  resolveWheelEngineeringSpec,
} from "./engineeringAdapters";
import { resolveWheelDimensions } from "./geometryAdapters";
import { resolveAssemblyMass } from "./massResolvers";
import type { RobotStabilityProfile } from "./robotStability";

export const STANDARD_GRAVITY_MPS2 = 9.80665;

export type PushForceLimiter = "motor-torque" | "tire-traction" | "none";

/**
 * Theoretical engineering performance metrics compiled from robot assembly and component specifications.
 */
export type RobotPerformanceProfile = {
  /** Total robot mass in canonical kilograms */
  totalMassKg: number;
  /** Number of active powered wheels assigned in the drivetrain */
  drivenWheelCount: number;
  /** Theoretical linear wheel surface top speed in meters per second (m/s) */
  topSpeedMps?: number;
  /** Theoretical top speed in kilometers per hour (km/h) */
  topSpeedKmh?: number;
  /** Theoretical stall push force produced by driven motors at the wheel contact patches in Newtons (N) */
  motorLimitedPushForceN?: number;
  /** Maximum push force sustainable before wheel slippage under static friction in Newtons (N) */
  tractionLimitedPushForceN?: number;
  /** Effective theoretical push force: min(motorLimited, tractionLimited) in Newtons (N) */
  theoreticalPushForceN?: number;
  /** Primary factor limiting theoretical push force */
  pushForceLimiter?: PushForceLimiter;
  /** Theoretical initial acceleration from rest in meters per second squared (m/s²) */
  maxAccelerationMps2?: number;
  /** Theoretical initial acceleration expressed as a fraction of standard gravity (g) */
  maxAccelerationG?: number;
  /** Lateral wheel track width between left and right driven wheel centers in canonical meters (m) */
  trackWidthM?: number;
  /** Longitudinal wheelbase between front and rear axle centers in canonical meters (m). 0 for single-axle */
  wheelbaseM?: number;
  /** Theoretical in-place spin turn yaw rate in radians per second (rad/s) */
  maxYawRateRadPerSec?: number;
  /** Theoretical in-place spin turn yaw rate in degrees per second (°/s) */
  maxYawRateDegPerSec?: number;
  /** Dimensionless ratio of effective push force to total robot weight */
  pushToWeightRatio?: number;
  /** Static stability profile compiled for this robot, if provided */
  stabilityProfile?: RobotStabilityProfile;
  /** Explicit engineering assumptions and caveats governing the calculation */
  assumptions: string[];
};

/**
 * Calculates theoretical linear wheel surface speed from motor no-load RPM and wheel diameter.
 *
 * v = (RPM * 2π / 60) * (diameter / 2)
 */
export function calculateWheelLinearSpeed(
  rpm: number,
  diameterM: number
): number {
  if (rpm <= 0 || diameterM <= 0 || !Number.isFinite(rpm) || !Number.isFinite(diameterM)) {
    return 0;
  }
  const angularVelocityRps = (rpm * Math.PI) / 30; // 2 * pi / 60
  const radiusM = diameterM / 2;
  return angularVelocityRps * radiusM;
}

/**
 * Translates motor stall torque to linear force at the wheel contact patch.
 *
 * F = torque / radius
 */
export function calculateMotorPushForce(
  stallTorqueNm: number,
  wheelRadiusM: number
): number {
  if (
    stallTorqueNm <= 0 ||
    wheelRadiusM <= 0 ||
    !Number.isFinite(stallTorqueNm) ||
    !Number.isFinite(wheelRadiusM)
  ) {
    return 0;
  }
  return stallTorqueNm / wheelRadiusM;
}

/**
 * Calculates maximum friction-limited push force before wheel slip.
 *
 * F_traction = µs * N_driven = µs * (M_driven * g)
 */
export function calculateTractionLimitedForce(
  staticFrictionCoeff: number,
  normalForceN: number
): number {
  if (
    staticFrictionCoeff <= 0 ||
    normalForceN <= 0 ||
    !Number.isFinite(staticFrictionCoeff) ||
    !Number.isFinite(normalForceN)
  ) {
    return 0;
  }
  return staticFrictionCoeff * normalForceN;
}

/**
 * Estimates theoretical initial acceleration from rest using Newton's second law.
 *
 * a = F_push / M_total
 */
export function calculateInitialAcceleration(
  pushForceN: number,
  totalMassKg: number
): number {
  if (
    pushForceN <= 0 ||
    totalMassKg <= 0 ||
    !Number.isFinite(pushForceN) ||
    !Number.isFinite(totalMassKg)
  ) {
    return 0;
  }
  return pushForceN / totalMassKg;
}

/**
 * Calculates theoretical differential-drive in-place spin turn yaw rate.
 * Assumes left and right wheels rotate at opposing no-load speeds with ideal rolling.
 *
 * ω_yaw = (2 * v_top) / trackWidth
 */
export function calculateDifferentialYawRate(
  topSpeedMps: number,
  trackWidthM: number
): number {
  if (
    topSpeedMps <= 0 ||
    trackWidthM <= 0 ||
    !Number.isFinite(topSpeedMps) ||
    !Number.isFinite(trackWidthM)
  ) {
    return 0;
  }
  return (2 * topSpeedMps) / trackWidthM;
}

type DrivenAssemblyData = {
  side: "left" | "right";
  motor: RobotPart;
  wheel: RobotPart;
  wheelDiameterM: number;
  wheelRadiusM: number;
  noLoadRpm?: number;
  stallTorqueNm?: number;
  staticFrictionCoeff: number;
  wheelPosition: [number, number, number];
};

/**
 * Pure compiler that derives a comprehensive RobotPerformanceProfile from current assembly state.
 */
export function compileRobotPerformanceProfile(
  parts: RobotPart[],
  connections: RobotConnection[],
  drivetrain?: DrivetrainConfiguration | null,
  stabilityProfile?: RobotStabilityProfile
): RobotPerformanceProfile {
  // 1. Total robot assembly mass (unified resolution)
  const assemblyMass = resolveAssemblyMass(parts);
  const totalMassKg = assemblyMass.totalMassKg;

  const assumptions: string[] = [];
  for (const inv of assemblyMass.invalidComponents) {
    if (inv.warning) {
      assumptions.push(inv.warning);
    }
  }

  // Guard against unconfigured or missing drivetrain
  if (!drivetrain || (!drivetrain.left.some(Boolean) && !drivetrain.right.some(Boolean))) {
    return {
      totalMassKg,
      drivenWheelCount: 0,
      stabilityProfile,
      assumptions: [
        ...assumptions,
        "No powered wheel assemblies assigned to drivetrain.",
      ],
    };
  }

  const partsById = new Map(parts.map((p) => [p.id, p]));
  const motorWheelConnections = new Set(
    connections
      .filter((c) => c.type === "Motor-Wheel")
      .map((c) => `${c.parentId ?? c.sourceId}:${c.childId ?? c.targetId}`)
  );

  const drivenAssemblies: DrivenAssemblyData[] = [];

  for (const side of ["left", "right"] as const) {
    for (const assignment of drivetrain[side]) {
      if (!assignment) continue;
      const motor = partsById.get(assignment.motorId);
      const wheel = partsById.get(assignment.wheelId);
      if (!motor || !wheel) continue;

      // Confirm physical Motor-Wheel connection exists
      const isConnected = motorWheelConnections.has(
        `${assignment.motorId}:${assignment.wheelId}`
      );
      if (!isConnected) continue;

      const wheelRes = resolveWheelDimensions(wheel);
      const wheelDiameterM = wheelRes.diameterM;
      const wheelRadiusM = wheelRes.radiusM;
      if (!wheelRes.isValid && wheelRes.warning) {
        assumptions.push(wheelRes.warning);
      }

      const motorSpec = resolveMotorEngineeringSpec(motor);
      const wheelSpec = resolveWheelEngineeringSpec(wheel);

      const noLoadRpm = motorSpec.mechanical?.noLoadSpeedRpm;
      const stallTorqueNm = motorSpec.mechanical?.stallTorqueNm;
      const staticFrictionCoeff =
        wheelSpec.traction?.staticFrictionCoeff ?? 0.85;

      drivenAssemblies.push({
        side,
        motor,
        wheel,
        wheelDiameterM,
        wheelRadiusM,
        noLoadRpm,
        stallTorqueNm,
        staticFrictionCoeff,
        wheelPosition: [...wheel.position] as [number, number, number],
      });
    }
  }

  const drivenWheelCount = drivenAssemblies.length;

  if (drivenWheelCount === 0) {
    return {
      totalMassKg,
      drivenWheelCount: 0,
      stabilityProfile,
      assumptions: [
        "Assigned drivetrain assemblies do not have valid motor-wheel attachments.",
      ],
    };
  }

  // 2. Track width and wheelbase derived from actual wheel world coordinates
  // Coordinate convention: X = longitudinal (front/rear), Y = vertical, Z = lateral (left/right)
  const leftZCoords = drivenAssemblies
    .filter((a) => a.side === "left")
    .map((a) => a.wheelPosition[2]);
  const rightZCoords = drivenAssemblies
    .filter((a) => a.side === "right")
    .map((a) => a.wheelPosition[2]);

  let trackWidthM: number | undefined;
  if (leftZCoords.length > 0 && rightZCoords.length > 0) {
    const avgLeftZ =
      leftZCoords.reduce((sum, z) => sum + z, 0) / leftZCoords.length;
    const avgRightZ =
      rightZCoords.reduce((sum, z) => sum + z, 0) / rightZCoords.length;
    const computedTrackWidth = Math.abs(avgLeftZ - avgRightZ);
    if (computedTrackWidth >= 0.005) {
      trackWidthM = computedTrackWidth;
    }
  }

  const xCoords = drivenAssemblies.map((a) => a.wheelPosition[0]);
  let wheelbaseM: number | undefined;
  if (xCoords.length > 0) {
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const deltaX = maxX - minX;
    wheelbaseM = deltaX >= 0.005 ? deltaX : 0;
  }

  // 3. Top speed
  const validSpeeds = drivenAssemblies
    .filter((a) => a.noLoadRpm !== undefined && a.noLoadRpm > 0 && a.wheelDiameterM > 0)
    .map((a) => calculateWheelLinearSpeed(a.noLoadRpm!, a.wheelDiameterM));

  let topSpeedMps: number | undefined;
  let topSpeedKmh: number | undefined;

  if (validSpeeds.length === drivenWheelCount && validSpeeds.length > 0) {
    // Symmetrical drivetrain top speed (bounded by slowest driven wheel assembly)
    topSpeedMps = Math.min(...validSpeeds);
    topSpeedKmh = topSpeedMps * 3.6;
    assumptions.push(
      "Top speed represents theoretical wheel linear velocity derived from motor no-load RPM and wheel diameter with zero slip."
    );
  } else {
    assumptions.push(
      "Top speed cannot be calculated because one or more driven motors lack verified RPM or wheel diameter."
    );
  }

  // 4. Motor-limited push force
  const validForces = drivenAssemblies
    .filter((a) => a.stallTorqueNm !== undefined && a.stallTorqueNm > 0 && a.wheelRadiusM > 0)
    .map((a) => calculateMotorPushForce(a.stallTorqueNm!, a.wheelRadiusM));

  let motorLimitedPushForceN: number | undefined;
  if (validForces.length === drivenWheelCount && validForces.length > 0) {
    motorLimitedPushForceN = validForces.reduce((sum, f) => sum + f, 0);
  } else {
    assumptions.push(
      "Motor-limited push force is partial or unavailable due to missing stall torque or wheel dimensions."
    );
  }

  // 5. Traction-limited push force
  // If a valid stabilityProfile with positive driven normal load is provided,
  // use geometry-based driven normal force.
  // Otherwise, explicitly fall back to nominal driven mass fraction (100% for 4WD, 60% for 2WD).
  const avgFrictionCoeff =
    drivenAssemblies.reduce((sum, a) => sum + a.staticFrictionCoeff, 0) /
    drivenWheelCount;

  let tractionLimitedPushForceN: number | undefined;

  if (
    stabilityProfile &&
    stabilityProfile.wheelLoadDistribution &&
    stabilityProfile.wheelLoadDistribution.validity === "valid" &&
    stabilityProfile.wheelLoadDistribution.drivenNormalForceN > 0
  ) {
    const normalForceN = stabilityProfile.wheelLoadDistribution.drivenNormalForceN;
    const drivenLoadFraction = stabilityProfile.wheelLoadDistribution.drivenLoadFraction;
    tractionLimitedPushForceN = calculateTractionLimitedForce(
      avgFrictionCoeff,
      normalForceN
    );
    assumptions.push(
      `Traction limit calculated from geometry-based driven wheel load (${(drivenLoadFraction * 100).toFixed(1)}% normal load, ${normalForceN.toFixed(1)} N) with average static friction µs = ${avgFrictionCoeff.toFixed(2)} on a clean, dry arena floor.`
    );
  } else if (totalMassKg > 0 && avgFrictionCoeff > 0) {
    const drivenMassFraction =
      drivetrain.type === "differential-4" || drivenWheelCount >= 4 ? 1.0 : 0.6;
    const drivenMassKg = totalMassKg * drivenMassFraction;
    const normalForceN = drivenMassKg * STANDARD_GRAVITY_MPS2;
    tractionLimitedPushForceN = calculateTractionLimitedForce(
      avgFrictionCoeff,
      normalForceN
    );
    if (stabilityProfile && stabilityProfile.wheelLoadDistribution?.validity !== "valid") {
      assumptions.push(
        `Traction limit falls back to nominal ${(drivenMassFraction * 100).toFixed(0)}% normal mass on driven wheels (stability calculation is invalid or unstable) with average static friction µs = ${avgFrictionCoeff.toFixed(2)} on a clean, dry arena floor.`
      );
    } else {
      assumptions.push(
        `Traction limit assumes ${(drivenMassFraction * 100).toFixed(0)}% normal mass on driven wheels with average static friction µs = ${avgFrictionCoeff.toFixed(2)} on a clean, dry arena floor.`
      );
    }
  }

  // 6. Effective push force and limiter
  let theoreticalPushForceN: number | undefined;
  let pushForceLimiter: PushForceLimiter = "none";

  if (
    motorLimitedPushForceN !== undefined &&
    tractionLimitedPushForceN !== undefined
  ) {
    if (motorLimitedPushForceN <= tractionLimitedPushForceN) {
      theoreticalPushForceN = motorLimitedPushForceN;
      pushForceLimiter = "motor-torque";
    } else {
      theoreticalPushForceN = tractionLimitedPushForceN;
      pushForceLimiter = "tire-traction";
    }
  } else if (motorLimitedPushForceN !== undefined) {
    theoreticalPushForceN = motorLimitedPushForceN;
    pushForceLimiter = "motor-torque";
  } else if (tractionLimitedPushForceN !== undefined) {
    theoreticalPushForceN = tractionLimitedPushForceN;
    pushForceLimiter = "tire-traction";
  }

  // 7. Initial acceleration and push-to-weight ratio
  let maxAccelerationMps2: number | undefined;
  let maxAccelerationG: number | undefined;
  let pushToWeightRatio: number | undefined;

  if (theoreticalPushForceN !== undefined && totalMassKg > 0) {
    maxAccelerationMps2 = calculateInitialAcceleration(
      theoreticalPushForceN,
      totalMassKg
    );
    maxAccelerationG = maxAccelerationMps2 / STANDARD_GRAVITY_MPS2;
    pushToWeightRatio =
      theoreticalPushForceN / (totalMassKg * STANDARD_GRAVITY_MPS2);
    assumptions.push(
      "Initial acceleration is estimated from effective stall push force and total assembly mass; rotational inertia of wheels/motor rotors is neglected."
    );
  }

  // 8. Yaw rate (spin turn)
  let maxYawRateRadPerSec: number | undefined;
  let maxYawRateDegPerSec: number | undefined;

  if (topSpeedMps !== undefined && trackWidthM !== undefined && trackWidthM > 0) {
    maxYawRateRadPerSec = calculateDifferentialYawRate(
      topSpeedMps,
      trackWidthM
    );
    maxYawRateDegPerSec = maxYawRateRadPerSec * (180 / Math.PI);
    assumptions.push(
      "Yaw rate represents ideal in-place spin turn (opposing wheel no-load velocities) assuming ideal kinematic rolling with zero lateral tire scrubbing."
    );
    if (drivetrain.type === "differential-4") {
      assumptions.push(
        "For 4WD differential drivetrains, actual yaw rate will be substantially lower than theoretical due to longitudinal wheel scrub."
      );
    }
  }

  return {
    totalMassKg,
    drivenWheelCount,
    topSpeedMps,
    topSpeedKmh,
    motorLimitedPushForceN,
    tractionLimitedPushForceN,
    theoreticalPushForceN,
    pushForceLimiter,
    maxAccelerationMps2,
    maxAccelerationG,
    trackWidthM,
    wheelbaseM,
    maxYawRateRadPerSec,
    maxYawRateDegPerSec,
    pushToWeightRatio,
    stabilityProfile,
    assumptions,
  };
}
