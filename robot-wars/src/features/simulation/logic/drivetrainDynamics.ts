/**
 * Pure 2D Differential-Drive Dynamics Engine for Robot Wars.
 *
 * Implements deterministic timestep-based planar motion simulation using
 * compiled SimulationRobotConfig contracts.
 *
 * Physical Coordinate Conventions:
 * - +X = forward baseline (longitudinal front)
 * - -X = rear baseline (longitudinal back)
 * - +Y = vertical up baseline (gravity acts in -Y)
 * - +Z = lateral left baseline
 * - -Z = lateral right baseline
 * - Heading θ = 0 points along +X.
 * - Positive yaw rate (ω_yaw > 0) turns counter-clockwise about +Y (from +X toward +Z, turning left).
 * - Net yaw torque: τ_yaw = (trackWidth / 2) * (F_right - F_left).
 *
 * Integration Method:
 * - Semi-implicit Euler integration:
 *   1. Calculate motor torques and ground traction limits.
 *   2. Sum forces and torques: F_net = F_left + F_right, τ_yaw = (w/2) * (F_right - F_left).
 *   3. Calculate accelerations: a_x = F_net / M, α_yaw = τ_yaw / I_yaw.
 *   4. Update velocities: v_x(t+dt) = v_x(t) + a_x * dt, ω_yaw(t+dt) = ω_yaw(t) + α_yaw * dt.
 *   5. Update heading: θ(t+dt) = θ(t) + ω_yaw(t+dt) * dt.
 *   6. Update world positions:
 *      X(t+dt) = X(t) + v_x(t+dt) * cos(θ(t+dt)) * dt
 *      Z(t+dt) = Z(t) + v_x(t+dt) * sin(θ(t+dt)) * dt
 *
 * Limitations & Assumptions:
 * - Pure 2D planar motion; assumes robot pitch and roll angles are zero.
 * - Simplified linear DC motor model without thermal derating or dynamic winding inductance.
 * - Symmetrical Coulomb friction limit |F_ground| <= μ * F_normal.
 * - Zero lateral wheel slip; differential drive tracks instantaneous velocity heading.
 * - When wheel rotational inertia is omitted, wheel speeds in slip equilibrium balance motor torque
 *   against ground friction without stiff ODE artifacts.
 *
 * Completely decoupled from React, Three.js, Zustand, DOM, and UI rendering.
 */

import type {
  ArenaConfig,
  DrivetrainDynamicsDiagnostics,
  DrivetrainInput,
  DynamicsStepResult,
  GroundSurface,
  MotorRuntimeElectricalState,
  MotorSimulationConfig,
  SimulationRobotConfig,
  SimulationState,
  WheelDynamicsDiagnostic,
  WheelSimulationConfig,
} from "../types/simulation.types";
import { resolveSurfaceAtPoint } from "./arenaModel";
import {
  DEFAULT_GROUND_SURFACE,
  resolveEffectiveStaticFriction,
} from "./surfaceModel";

/**
 * Standard gravitational acceleration in m/s².
 */
export const STANDARD_GRAVITY_MPS2 = 9.80665;

/**
 * Default friction coefficient when unspecified in wheel engineering specs.
 * Corresponds to standard arena steel floor (μs = 0.85).
 */
export const DEFAULT_FRICTION_COEFF = DEFAULT_GROUND_SURFACE.staticFrictionCoeff;

/**
 * Result of motor torque calculation.
 */
export interface MotorTorqueResult {
  readonly torqueNm: number;
  readonly operatingAngularVelocityRadPerSec: number;
  readonly isOverspeed: boolean;
  readonly isPlugging: boolean;
}

/**
 * Normalizes an angle in radians to the range (-π, π].
 */
export function normalizeAngle(radians: number): number {
  if (!Number.isFinite(radians)) {
    return 0;
  }
  let angle = radians % (2 * Math.PI);
  if (angle > Math.PI) {
    angle -= 2 * Math.PI;
  } else if (angle <= -Math.PI) {
    angle += 2 * Math.PI;
  }
  return angle;
}

/**
 * Factory creating a clean initial SimulationState at rest.
 */
export function createInitialSimulationState(
  initialPose: { x?: number; z?: number; heading?: number } = {},
  batteryVoltageV = 12.0
): SimulationState {
  return {
    timeSeconds: 0,
    stepCount: 0,
    xMeters: initialPose.x ?? 0,
    zMeters: initialPose.z ?? 0,
    headingRadians: normalizeAngle(initialPose.heading ?? 0),
    longitudinalVelocityMps: 0,
    lateralVelocityMps: 0,
    yawRateRadPerSec: 0,
    longitudinalAccelerationMps2: 0,
    angularAccelerationRadPerSec2: 0,
    leftWheelAngularVelocityRadPerSec: 0,
    rightWheelAngularVelocityRadPerSec: 0,
    leftWheelLinearSurfaceSpeedMps: 0,
    rightWheelLinearSurfaceSpeedMps: 0,
    leftSlipRatio: 0,
    rightSlipRatio: 0,
    batteryTerminalVoltageV: batteryVoltageV,
    totalCurrentDrawA: 0,
    netDriveForceN: 0,
    netYawTorqueNm: 0,
  };
}

/**
 * Calculates DC motor output torque under commanded throttle and current operating angular velocity.
 *
 * Motor Model Physics:
 * - Linear torque-speed curve:
 *   τ = τ_stall * (u - ω / ω_noLoad)
 * - Throttle u in [-1.0, 1.0].
 * - Forward drive (u > 0):
 *   - At ω = 0: produces stall torque u * τ_stall.
 *   - Torque decreases linearly toward zero at commanded no-load speed u * ω_noLoad.
 *   - At or above commanded no-load speed (overspeed), driving torque clamps to 0 (no reverse drag from forward throttle).
 *   - Reverse rotation (ω < 0, plugging): produces forward torque to oppose reverse motion, clamped to τ_stall.
 * - Reverse drive (u < 0):
 *   - At ω = 0: produces reverse stall torque u * τ_stall = -|u| * τ_stall.
 *   - Torque decreases toward zero at reverse no-load speed u * ω_noLoad.
 *   - At or below reverse no-load speed (reverse overspeed), driving torque clamps to 0.
 *   - Forward rotation (ω > 0, plugging): produces reverse torque to oppose forward motion, clamped to -τ_stall.
 * - Neutral (u = 0):
 *   - Produces exactly 0 torque, preventing artificial motion at rest.
 *
 * @param stallTorqueNm Stall torque in N·m (must be strictly positive).
 * @param noLoadAngularVelocityRadPerSec No-load speed in rad/s (must be strictly positive).
 * @param throttle Command in [-1.0, 1.0].
 * @param currentAngularVelocityRadPerSec Current shaft angular velocity in rad/s.
 */
export function calculateMotorTorque(
  stallTorqueNm: number,
  noLoadAngularVelocityRadPerSec: number,
  throttle: number,
  currentAngularVelocityRadPerSec: number
): MotorTorqueResult {
  if (
    !Number.isFinite(stallTorqueNm) ||
    stallTorqueNm <= 0 ||
    !Number.isFinite(noLoadAngularVelocityRadPerSec) ||
    noLoadAngularVelocityRadPerSec <= 0
  ) {
    return {
      torqueNm: 0,
      operatingAngularVelocityRadPerSec: currentAngularVelocityRadPerSec,
      isOverspeed: false,
      isPlugging: false,
    };
  }

  const u = Math.max(-1.0, Math.min(1.0, throttle));
  const omega = Number.isFinite(currentAngularVelocityRadPerSec)
    ? currentAngularVelocityRadPerSec
    : 0;

  // Zero throttle delivers zero drive torque (neutral)
  if (Math.abs(u) < 1e-6) {
    return {
      torqueNm: 0,
      operatingAngularVelocityRadPerSec: omega,
      isOverspeed: false,
      isPlugging: false,
    };
  }

  if (u > 0) {
    // Forward commanded throttle
    const commandedNoLoadOmega = u * noLoadAngularVelocityRadPerSec;
    const isOverspeed = omega >= commandedNoLoadOmega;
    const isPlugging = omega < 0;

    if (isOverspeed) {
      // Motor cannot accelerate beyond its no-load speed; driving torque drops to zero
      return {
        torqueNm: 0,
        operatingAngularVelocityRadPerSec: omega,
        isOverspeed: true,
        isPlugging: false,
      };
    }

    // Linear decrease: at omega = 0 -> u * stallTorqueNm; at omega = commandedNoLoadOmega -> 0
    const rawTorque = stallTorqueNm * (u - omega / noLoadAngularVelocityRadPerSec);
    // Clamp to maximum stall torque (for plugging) and floor at 0
    const torqueNm = Math.max(0, Math.min(stallTorqueNm, rawTorque));

    return {
      torqueNm,
      operatingAngularVelocityRadPerSec: omega,
      isOverspeed: false,
      isPlugging,
    };
  } else {
    // Reverse commanded throttle (u < 0)
    const commandedReverseNoLoadOmega = u * noLoadAngularVelocityRadPerSec; // negative
    const isOverspeed = omega <= commandedReverseNoLoadOmega;
    const isPlugging = omega > 0;

    if (isOverspeed) {
      // Motor cannot accelerate beyond its reverse no-load speed
      return {
        torqueNm: 0,
        operatingAngularVelocityRadPerSec: omega,
        isOverspeed: true,
        isPlugging: false,
      };
    }

    // Linear increase towards zero: at omega = 0 -> u * stallTorqueNm (< 0); at reverse no-load -> 0
    const rawTorque = stallTorqueNm * (u - omega / noLoadAngularVelocityRadPerSec);
    // Clamp to negative stall torque (for plugging) and ceiling at 0
    const torqueNm = Math.min(0, Math.max(-stallTorqueNm, rawTorque));

    return {
      torqueNm,
      operatingAngularVelocityRadPerSec: omega,
      isOverspeed: false,
      isPlugging,
    };
  }
}

/**
 * Calculates the maximum longitudinal traction force a wheel can transmit before slip.
 *
 * F_traction_max = μ * F_normal
 */
export function calculateWheelTractionLimit(
  staticFrictionCoeff: number,
  normalForceN: number
): number {
  if (
    !Number.isFinite(staticFrictionCoeff) ||
    staticFrictionCoeff <= 0 ||
    !Number.isFinite(normalForceN) ||
    normalForceN <= 0
  ) {
    return 0;
  }
  return staticFrictionCoeff * normalForceN;
}

/**
 * Resolves the static normal force acting on a specific wheel.
 */
function resolveWheelNormalForce(
  wheel: WheelSimulationConfig,
  config: SimulationRobotConfig,
  totalDrivenWheels: number
): number {
  if (wheel.normalLoadN && wheel.normalLoadN > 0 && Number.isFinite(wheel.normalLoadN)) {
    return wheel.normalLoadN;
  }

  // Look up in baseline normal load distribution
  if (config.normalLoads?.perWheelLoads) {
    const pw = config.normalLoads.perWheelLoads.find(
      (p) => p.wheelId === wheel.wheelId
    );
    if (pw && pw.normalForceN > 0 && Number.isFinite(pw.normalForceN)) {
      return pw.normalForceN;
    }
  }

  // Fallback: distribute total weight evenly among driven wheels
  const totalWeightN = config.totalMassKg * STANDARD_GRAVITY_MPS2;
  const count = Math.max(1, totalDrivenWheels);
  return totalWeightN / count;
}

/**
 * Computes the body-fixed (x = forward, z = left) contact point offset for a wheel.
 * Uses compiled localPosition when available, falling back to trackWidthM / wheelbaseM geometry.
 */
export function resolveWheelLocalPosition(
  config: SimulationRobotConfig,
  wheel: WheelSimulationConfig
): { readonly x: number; readonly z: number } {
  if (
    wheel.localPosition &&
    Number.isFinite(wheel.localPosition.x) &&
    Number.isFinite(wheel.localPosition.z)
  ) {
    return wheel.localPosition;
  }

  const sideCount = config.wheels.filter((w) => w.side === wheel.side).length;
  const localX =
    sideCount >= 2 &&
    config.wheelbaseM !== null &&
    Number.isFinite(config.wheelbaseM) &&
    config.wheelbaseM > 0
      ? wheel.slotIndex === 0
        ? config.wheelbaseM / 2
        : -config.wheelbaseM / 2
      : 0;
  const localZ =
    wheel.side === "left" ? config.trackWidthM / 2 : -config.trackWidthM / 2;

  return { x: localX, z: localZ };
}

/**
 * Transforms a wheel's body-frame contact point into arena world X-Z coordinates.
 */
export function resolveWheelContactWorldPosition(
  config: SimulationRobotConfig,
  state: SimulationState,
  wheel: WheelSimulationConfig
): { readonly x: number; readonly z: number } {
  const local = resolveWheelLocalPosition(config, wheel);
  const cos = Math.cos(state.headingRadians);
  const sin = Math.sin(state.headingRadians);
  return {
    x: state.xMeters + local.x * cos - local.z * sin,
    z: state.zMeters + local.x * sin + local.z * cos,
  };
}

/**
 * Resolves the effective GroundSurface beneath a specific wheel contact point.
 * Explicit global surface overrides take precedence; otherwise queries ArenaConfig spatially.
 */
export function resolveWheelGroundSurface(
  config: SimulationRobotConfig,
  state: SimulationState,
  wheel: WheelSimulationConfig,
  explicitSurface?: GroundSurface,
  arena?: ArenaConfig
): {
  readonly surface: GroundSurface;
  readonly contactWorldPosition: { readonly x: number; readonly z: number };
} {
  const contactWorldPosition = resolveWheelContactWorldPosition(config, state, wheel);
  if (explicitSurface !== undefined) {
    return { surface: explicitSurface, contactWorldPosition };
  }
  if (arena !== undefined) {
    return {
      surface: resolveSurfaceAtPoint(
        arena,
        contactWorldPosition.x,
        contactWorldPosition.z
      ),
      contactWorldPosition,
    };
  }
  return { surface: DEFAULT_GROUND_SURFACE, contactWorldPosition };
}

/**
 * Pure, deterministic timestep-based 2D differential-drive dynamics engine.
 *
 * Accepts:
 * - config: SimulationRobotConfig (robot mass, yaw inertia, track width, motors, wheels)
 * - currentState: SimulationState (current pose, velocities, accelerations, wheel speeds)
 * - input: DrivetrainInput (left and right throttle [-1.0, 1.0])
 * - dt: timestep in seconds (dt > 0)
 * - operatingVoltageV / totalCurrentDrawA: optional coupled battery electrical point
 * - surface: optional explicit global ground surface override
 * - arena: optional arena configuration for per-wheel spatial surface zone sampling
 *
 * Returns:
 * - updatedState: SimulationState
 * - diagnostics: DrivetrainDynamicsDiagnostics
 *
 * Does not mutate inputs. Pure analytical calculation.
 */
export function stepDrivetrainDynamics(
  config: SimulationRobotConfig,
  currentState: SimulationState,
  input: DrivetrainInput,
  dt: number,
  operatingVoltageV?: number,
  totalCurrentDrawA?: number,
  surface?: GroundSurface,
  arena?: ArenaConfig,
  perMotorElectrical?: Readonly<Record<string, MotorRuntimeElectricalState>>
): DynamicsStepResult {
  // 1. Validation & Safety
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error(`Invalid timestep: dt must be a positive finite number, received: ${dt}`);
  }
  if (!input || !Number.isFinite(input.leftThrottle) || !Number.isFinite(input.rightThrottle)) {
    throw new Error("Invalid drivetrain input: leftThrottle and rightThrottle must be finite numbers.");
  }
  if (
    !currentState ||
    !Number.isFinite(currentState.xMeters) ||
    !Number.isFinite(currentState.zMeters) ||
    !Number.isFinite(currentState.headingRadians) ||
    !Number.isFinite(currentState.longitudinalVelocityMps) ||
    !Number.isFinite(currentState.lateralVelocityMps) ||
    !Number.isFinite(currentState.yawRateRadPerSec) ||
    !Number.isFinite(currentState.leftWheelAngularVelocityRadPerSec) ||
    !Number.isFinite(currentState.rightWheelAngularVelocityRadPerSec)
  ) {
    throw new Error("Invalid currentState: state must contain finite numbers.");
  }
  if (!config || !Number.isFinite(config.totalMassKg) || config.totalMassKg <= 0) {
    throw new Error("Invalid robot configuration: totalMassKg must be a positive finite number.");
  }
  if (!Number.isFinite(config.yawInertiaKgM2) || config.yawInertiaKgM2 <= 0) {
    throw new Error("Invalid robot configuration: yawInertiaKgM2 must be a positive finite number.");
  }
  if (!Number.isFinite(config.trackWidthM) || config.trackWidthM <= 0) {
    throw new Error("Invalid robot configuration: trackWidthM must be a positive finite number.");
  }
  if (!config.motors || config.motors.length === 0) {
    throw new Error("Invalid robot configuration: motors array must not be empty.");
  }
  if (!config.wheels || config.wheels.length === 0) {
    throw new Error("Invalid robot configuration: wheels array must not be empty.");
  }

  const leftThrottle = Math.max(-1.0, Math.min(1.0, input.leftThrottle));
  const rightThrottle = Math.max(-1.0, Math.min(1.0, input.rightThrottle));

  const totalDrivenWheels = config.wheels.length;
  const trackWidthM = config.trackWidthM;
  const halfTrackWidthM = trackWidthM / 2;

  // Current body-fixed kinematic velocities
  const currentVx = currentState.longitudinalVelocityMps;
  const currentOmegaYaw = currentState.yawRateRadPerSec;

  // Ground contact speeds at left and right wheel baselines (+Z is left, -Z is right)
  const leftContactSpeed = currentVx - halfTrackWidthM * currentOmegaYaw;
  const rightContactSpeed = currentVx + halfTrackWidthM * currentOmegaYaw;

  // 2. Per-Wheel Motor Torque and Ground Force Calculations
  const wheelDiagnostics: WheelDynamicsDiagnostic[] = [];
  let leftTotalGroundForceN = 0;
  let rightTotalGroundForceN = 0;
  let anyTractionLimited = false;

  const leftWheels: {
    wheel: WheelSimulationConfig;
    motor: MotorSimulationConfig;
    tractionLimitN: number;
  }[] = [];
  const rightWheels: {
    wheel: WheelSimulationConfig;
    motor: MotorSimulationConfig;
    tractionLimitN: number;
  }[] = [];

  for (const wheel of config.wheels) {
    if (wheel.radiusM <= 0 || !Number.isFinite(wheel.radiusM)) {
      throw new Error(`Wheel "${wheel.name}" (${wheel.wheelId}) has invalid non-positive radius.`);
    }

    // Match corresponding motor by side and slotIndex
    const motor = config.motors.find(
      (m) => m.side === wheel.side && m.slotIndex === wheel.slotIndex
    );
    if (!motor) {
      throw new Error(
        `No motor found matching wheel "${wheel.name}" on side "${wheel.side}" slot ${wheel.slotIndex}.`
      );
    }

    if (motor.stallTorqueNm <= 0 || !Number.isFinite(motor.stallTorqueNm)) {
      throw new Error(`Motor "${motor.name}" (${motor.motorId}) has invalid stall torque.`);
    }
    if (
      motor.noLoadAngularVelocityRadPerSec <= 0 ||
      !Number.isFinite(motor.noLoadAngularVelocityRadPerSec)
    ) {
      throw new Error(`Motor "${motor.name}" (${motor.motorId}) has invalid no-load angular velocity.`);
    }

    const isLeft = wheel.side === "left";
    const throttle = isLeft ? leftThrottle : rightThrottle;
    const contactSpeed = isLeft ? leftContactSpeed : rightContactSpeed;

    // Operating angular velocity from previous state
    const currentWheelOmega = isLeft
      ? currentState.leftWheelAngularVelocityRadPerSec
      : currentState.rightWheelAngularVelocityRadPerSec;

    const motorElec = perMotorElectrical?.[motor.motorId];
    const effectiveOperatingVoltageV =
      motorElec !== undefined
        ? motorElec.isPowered
          ? motorElec.operatingVoltageV
          : 0
        : operatingVoltageV;

    // Voltage scaling of motor capability (supports per-motor regulated/unpowered branches)
    const nominalVoltageV =
      motor.nominalVoltageV ?? config.battery?.nominalVoltageV ?? 12.0;
    const voltageRatio =
      effectiveOperatingVoltageV !== undefined
        ? nominalVoltageV > 0
          ? Math.max(0, effectiveOperatingVoltageV / nominalVoltageV)
          : 1.0
        : 1.0;

    const effectiveStallTorqueNm = motor.stallTorqueNm * voltageRatio;
    const effectiveNoLoadOmega = motor.noLoadAngularVelocityRadPerSec * voltageRatio;

    // Motor torque calculation (zero electrical torque when unpowered; scaled when driver/battery current-limited)
    const rawMotorRes =
      motorElec && !motorElec.isPowered
        ? { torqueNm: 0 }
        : calculateMotorTorque(
            effectiveStallTorqueNm,
            effectiveNoLoadOmega,
            throttle,
            currentWheelOmega
          );
    const scaledTorqueNm =
      motorElec && motorElec.isPowered
        ? rawMotorRes.torqueNm * motorElec.torqueScaleFactor
        : rawMotorRes.torqueNm;
    const motorRes = { torqueNm: scaledTorqueNm };

    // Longitudinal drive force transmitted to the wheel rim: F = τ / r
    const wheelDriveForceN = motorRes.torqueNm / wheel.radiusM;

    // Resolve spatial ground surface at this wheel's world contact point
    const { surface: resolvedSurface, contactWorldPosition } =
      resolveWheelGroundSurface(config, currentState, wheel, surface, arena);

    // Normal force and traction limit: F_trac_max = μ * F_N
    const normalForceN = resolveWheelNormalForce(wheel, config, totalDrivenWheels);
    const frictionCoeff = resolveEffectiveStaticFriction(
      wheel.staticFrictionCoeff,
      resolvedSurface
    );
    const tractionLimitN = calculateWheelTractionLimit(frictionCoeff, normalForceN);

    if (isLeft) {
      leftWheels.push({ wheel, motor, tractionLimitN });
    } else {
      rightWheels.push({ wheel, motor, tractionLimitN });
    }

    // Clamping to Coulomb static traction limit
    const isTractionLimited = Math.abs(wheelDriveForceN) > tractionLimitN + 1e-6;
    if (isTractionLimited) {
      anyTractionLimited = true;
    }

    const groundForceN = Math.max(
      -tractionLimitN,
      Math.min(tractionLimitN, wheelDriveForceN)
    );

    if (isLeft) {
      leftTotalGroundForceN += groundForceN;
    } else {
      rightTotalGroundForceN += groundForceN;
    }

    // Wheel surface speed and slip ratio for diagnostic output
    const surfaceSpeedMps = currentWheelOmega * wheel.radiusM;
    const speedDenom = Math.max(Math.abs(surfaceSpeedMps), Math.abs(contactSpeed), 1.0);
    const slipRatio = (surfaceSpeedMps - contactSpeed) / speedDenom;

    wheelDiagnostics.push({
      wheelId: wheel.wheelId,
      side: wheel.side,
      slotIndex: wheel.slotIndex,
      motorId: motor.motorId,
      motorTorqueNm: motorRes.torqueNm,
      motorAngularVelocityRadPerSec: currentWheelOmega,
      wheelAngularVelocityRadPerSec: currentWheelOmega,
      surfaceSpeedMps,
      groundContactSpeedMps: contactSpeed,
      slipRatio,
      normalForceN,
      tractionLimitN,
      groundForceN,
      isTractionLimited,
      surfaceId: resolvedSurface.id,
      effectiveFrictionCoeff: frictionCoeff,
      contactWorldPosition,
      ...(motorElec && {
        operatingVoltageV: motorElec.operatingVoltageV,
        electricalCurrentA: motorElec.currentDrawA,
        isElectricalPowered: motorElec.isPowered,
        isCurrentLimited: motorElec.isCurrentLimited,
        electricalFaultReason: motorElec.faultReason,
      }),
    });
  }

  // 3. Planar Rigid-Body Dynamics
  // Longitudinal net force: F_net = F_left + F_right
  const netDriveForceN = leftTotalGroundForceN + rightTotalGroundForceN;

  // Yaw torque about vertical +Y axis:
  // Right wheels located at -w/2 (-Z) push forward (+X), creating positive torque (+Y, turning left).
  // Left wheels located at +w/2 (+Z) push forward (+X), creating negative torque (-Y, turning right).
  // τ_yaw = (w/2) * (F_right - F_left)
  const netYawTorqueNm = halfTrackWidthM * (rightTotalGroundForceN - leftTotalGroundForceN);

  // Linear and angular accelerations
  const longitudinalAccelerationMps2 = netDriveForceN / config.totalMassKg;
  const angularAccelerationRadPerSec2 = netYawTorqueNm / config.yawInertiaKgM2;

  // 4. Semi-Implicit Euler Integration
  // Update velocities first
  const newVx = currentVx + longitudinalAccelerationMps2 * dt;
  const newOmegaYaw = currentOmegaYaw + angularAccelerationRadPerSec2 * dt;

  // Update heading using new angular velocity
  const newHeading = normalizeAngle(currentState.headingRadians + newOmegaYaw * dt);

  // Preserve body-fixed lateral velocity (e.g., induced by planar collision impulses)
  const newVz = currentState.lateralVelocityMps;

  // Update arena world positions using new velocities and updated heading
  // Arena world frame: +X = forward, +Z = left
  const cosHeading = Math.cos(newHeading);
  const sinHeading = Math.sin(newHeading);
  const newX =
    currentState.xMeters + (newVx * cosHeading - newVz * sinHeading) * dt;
  const newZ =
    currentState.zMeters + (newVx * sinHeading + newVz * cosHeading) * dt;

  // 5. Update Wheel States
  // Kinematic contact speeds after acceleration
  const newLeftContactSpeed = newVx - halfTrackWidthM * newOmegaYaw;
  const newRightContactSpeed = newVx + halfTrackWidthM * newOmegaYaw;

  function computeUpdatedWheelSpeed(
    wheels: {
      wheel: WheelSimulationConfig;
      motor: MotorSimulationConfig;
      tractionLimitN: number;
    }[],
    contactSpeed: number,
    throttle: number
  ): { angularVelocity: number; surfaceSpeed: number; slipRatio: number } {
    if (wheels.length === 0) {
      return { angularVelocity: 0, surfaceSpeed: 0, slipRatio: 0 };
    }

    let sumOmega = 0;
    let sumSurface = 0;
    let sumSlip = 0;

    for (const { wheel, motor, tractionLimitN } of wheels) {
      const motorElec = perMotorElectrical?.[motor.motorId];
      const isMotorPowered = motorElec ? motorElec.isPowered : true;
      const effectiveWheelVoltageV = motorElec
        ? isMotorPowered
          ? motorElec.operatingVoltageV
          : 0
        : operatingVoltageV;
      const torqueScale = motorElec
        ? isMotorPowered
          ? motorElec.torqueScaleFactor
          : 0
        : 1.0;

      const nominalVoltageV =
        motor.nominalVoltageV ?? config.battery?.nominalVoltageV ?? 12.0;
      const voltageRatio =
        effectiveWheelVoltageV !== undefined
          ? nominalVoltageV > 0
            ? Math.max(0, effectiveWheelVoltageV / nominalVoltageV)
            : 1.0
          : 1.0;
      const effectiveStallTorqueNm =
        (isMotorPowered ? motor.stallTorqueNm * voltageRatio : 0) * torqueScale;
      const effectiveNoLoadOmega = isMotorPowered
        ? motor.noLoadAngularVelocityRadPerSec * voltageRatio
        : 0;

      const maxDriveForceN = effectiveStallTorqueNm / wheel.radiusM;

      let wheelOmega: number;

      if (Math.abs(throttle) < 1e-6 || effectiveStallTorqueNm <= 0) {
        // Zero throttle or unpowered: wheels roll synchronously with contact velocity (no slip)
        wheelOmega = contactSpeed / wheel.radiusM;
      } else if (maxDriveForceN > tractionLimitN + 1e-6) {
        // Traction saturated only while slip equilibrium spins faster in commanded direction than ground contact
        // τ_stall * (u - ω / ω_noLoad) = sign(u) * F_traction_max * r
        const u = Math.max(-1.0, Math.min(1.0, throttle));
        const sign = u >= 0 ? 1 : -1;
        const slipOmega =
          effectiveNoLoadOmega *
          (u - (sign * tractionLimitN * wheel.radiusM) / effectiveStallTorqueNm);
        const rollingOmega = contactSpeed / wheel.radiusM;

        const isForwardSlip = u > 0 && slipOmega > rollingOmega;
        const isReverseSlip = u < 0 && slipOmega < rollingOmega;
        wheelOmega = isForwardSlip || isReverseSlip ? slipOmega : rollingOmega;
      } else {
        // Wheel rolls with ground contact without gross slip
        wheelOmega = contactSpeed / wheel.radiusM;
      }

      const surfaceSpeed = wheelOmega * wheel.radiusM;
      const speedDenom = Math.max(Math.abs(surfaceSpeed), Math.abs(contactSpeed), 1.0);
      const slip = (surfaceSpeed - contactSpeed) / speedDenom;

      sumOmega += wheelOmega;
      sumSurface += surfaceSpeed;
      sumSlip += slip;
    }

    const n = wheels.length;
    return {
      angularVelocity: sumOmega / n,
      surfaceSpeed: sumSurface / n,
      slipRatio: sumSlip / n,
    };
  }

  const updatedLeft = computeUpdatedWheelSpeed(leftWheels, newLeftContactSpeed, leftThrottle);
  const updatedRight = computeUpdatedWheelSpeed(rightWheels, newRightContactSpeed, rightThrottle);

  // 6. Build Immutable Result
  const updatedState: SimulationState = {
    timeSeconds: currentState.timeSeconds + dt,
    stepCount: currentState.stepCount + 1,
    xMeters: newX,
    zMeters: newZ,
    headingRadians: newHeading,
    longitudinalVelocityMps: newVx,
    lateralVelocityMps: newVz,
    yawRateRadPerSec: newOmegaYaw,
    longitudinalAccelerationMps2,
    angularAccelerationRadPerSec2,
    leftWheelAngularVelocityRadPerSec: updatedLeft.angularVelocity,
    rightWheelAngularVelocityRadPerSec: updatedRight.angularVelocity,
    leftWheelLinearSurfaceSpeedMps: updatedLeft.surfaceSpeed,
    rightWheelLinearSurfaceSpeedMps: updatedRight.surfaceSpeed,
    leftSlipRatio: updatedLeft.slipRatio,
    rightSlipRatio: updatedRight.slipRatio,
    batteryTerminalVoltageV:
      operatingVoltageV !== undefined
        ? operatingVoltageV
        : (config.battery?.nominalVoltageV ?? currentState.batteryTerminalVoltageV),
    totalCurrentDrawA:
      totalCurrentDrawA !== undefined
        ? totalCurrentDrawA
        : currentState.totalCurrentDrawA,
    netDriveForceN,
    netYawTorqueNm,
  };

  const diagnostics: DrivetrainDynamicsDiagnostics = {
    timestepSeconds: dt,
    leftDriveForceN: leftTotalGroundForceN,
    rightDriveForceN: rightTotalGroundForceN,
    netLongitudinalForceN: netDriveForceN,
    netYawTorqueNm,
    linearAccelerationMps2: longitudinalAccelerationMps2,
    angularAccelerationRadPerSec2,
    wheels: wheelDiagnostics,
    isTractionLimited: anyTractionLimited,
    leftThrottle,
    rightThrottle,
  };

  return {
    state: updatedState,
    diagnostics,
  };
}
