import type { DrivetrainSide } from "../../robot-builder/types/robot.types";
import type {
  MotorRuntimeElectricalState,
  RuntimeElectricalState,
  SimulationRobotConfig,
  WheelSimulationConfig,
} from "../../simulation/types/simulation.types";
import type {
  DifferentialDriveGeometryOverride,
  DifferentialDriveModel,
  DifferentialDriveResolution,
  DifferentialDriveSideModel,
  DifferentialDriveTwistCommand,
  DifferentialWheelTarget,
  MotorHardwareBinding,
  NormalizedVelocityCommand,
} from "../types/control.types";

const EPSILON = 1e-9;

function zeroIfTiny(value: number): number {
  return Math.abs(value) < EPSILON ? 0 : value;
}

function clampUnit(value: number): number {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return zeroIfTiny(value);
}

function createEmptySideModel(side: DrivetrainSide): DifferentialDriveSideModel {
  return {
    side,
    wheelCount: 0,
    wheelIds: [],
    motorIds: [],
    effectiveWheelRadiusM: 0,
    maxWheelAngularVelocityRadPerSec: 0,
    maxLinearVelocityMps: 0,
    totalStallTorqueNm: 0,
    poweredMotorCount: 0,
    isDrivable: false,
  };
}

export function createInvalidDifferentialDriveModel(
  reason: string,
  drivetrainType: DifferentialDriveModel["drivetrainType"] = "unsupported",
  warnings: readonly string[] = []
): DifferentialDriveModel {
  return {
    isValid: false,
    drivetrainType,
    trackWidthM: 0,
    left: createEmptySideModel("left"),
    right: createEmptySideModel("right"),
    maxLinearVelocityMps: 0,
    maxAngularVelocityRadPerSec: 0,
    warnings,
    errors: [reason],
  };
}

function buildSideModel(params: {
  readonly side: DrivetrainSide;
  readonly robotConfig: SimulationRobotConfig;
  readonly runtimeElectricalState?: RuntimeElectricalState;
  readonly binding?: MotorHardwareBinding;
  readonly explicitRadiusM?: number;
  readonly batteryTerminalVoltageV?: number;
  readonly warnings: string[];
  readonly errors: string[];
}): DifferentialDriveSideModel {
  const {
    side,
    robotConfig,
    runtimeElectricalState,
    binding,
    explicitRadiusM,
    batteryTerminalVoltageV,
    warnings,
    errors,
  } = params;

  const sideWheels = robotConfig.wheels.filter((wheel) => wheel.side === side);
  if (sideWheels.length === 0) {
    errors.push(`Differential drivetrain is missing driven wheels on the ${side} side.`);
    return createEmptySideModel(side);
  }

  const expectedCount = robotConfig.drivetrain.type === "differential-4" ? 2 : 1;
  if (sideWheels.length !== expectedCount) {
    errors.push(
      `${robotConfig.drivetrain.type} requires ${expectedCount} wheel(s) on the ${side} side (found ${sideWheels.length}).`
    );
    return createEmptySideModel(side);
  }

  const runtimeByMotorId = new Map<string, MotorRuntimeElectricalState>();
  for (const state of runtimeElectricalState?.motorStates ?? []) {
    runtimeByMotorId.set(state.motorId, state);
  }

  const compiledPathByMotorId = new Map(
    (robotConfig.electrical?.motorPaths ?? []).map((path) => [path.motorId, path])
  );

  const wheelIds: string[] = [];
  const motorIds: string[] = [];
  let radiusSum = 0;
  let minPoweredLinearMps = Number.POSITIVE_INFINITY;
  let totalStallTorqueNm = 0;
  let poweredMotorCount = 0;

  for (const wheel of sideWheels) {
    const motor = robotConfig.motors.find(
      (item) => item.side === side && item.slotIndex === wheel.slotIndex
    );
    if (!motor) {
      errors.push(
        `Wheel "${wheel.name}" (${wheel.wheelId}) on ${side} slot ${wheel.slotIndex} has no matching motor.`
      );
      return createEmptySideModel(side);
    }
    const resolvedRadiusM = explicitRadiusM ?? wheel.radiusM;
    if (!Number.isFinite(resolvedRadiusM) || resolvedRadiusM <= 0) {
      errors.push(
        `Wheel "${wheel.name}" (${wheel.wheelId}) has non-positive or non-finite radius.`
      );
      return createEmptySideModel(side);
    }
    if (
      !Number.isFinite(motor.noLoadAngularVelocityRadPerSec) ||
      motor.noLoadAngularVelocityRadPerSec <= 0 ||
      !Number.isFinite(motor.stallTorqueNm) ||
      motor.stallTorqueNm <= 0
    ) {
      errors.push(
        `Motor "${motor.name}" (${motor.motorId}) has invalid speed or stall torque specifications.`
      );
      return createEmptySideModel(side);
    }

    wheelIds.push(wheel.wheelId);
    motorIds.push(motor.motorId);
    radiusSum += resolvedRadiusM;

    const runtimeState = runtimeByMotorId.get(motor.motorId);
    const compiledPath = compiledPathByMotorId.get(motor.motorId);
    const switchBlocked = Boolean(
      runtimeElectricalState &&
        compiledPath?.seriesSwitchIds.some(
          (swId) => runtimeElectricalState.switchStates[swId] === false
        )
    );
    const fuseTripped = Boolean(
      runtimeElectricalState &&
        compiledPath?.seriesFuseIds.some((fuseId) =>
          runtimeElectricalState.trippedFuseIds.includes(fuseId)
        )
    );
    const pathUnpowered =
      binding?.canDrive === false ||
      (runtimeState !== undefined && !runtimeState.isPowered) ||
      (compiledPath !== undefined &&
        (!compiledPath.canEnergize || compiledPath.hasCompileFault)) ||
      switchBlocked ||
      fuseTripped;

    if (pathUnpowered) {
      warnings.push(
        runtimeState?.faultReason ??
          compiledPath?.faultReason ??
          `Drive motor "${motor.name}" on ${side} side cannot currently energize.`
      );
      continue;
    }

    const nominalV =
      motor.nominalVoltageV ?? robotConfig.battery?.nominalVoltageV ?? 12.0;
    const supplyV =
      runtimeState && runtimeState.operatingVoltageV > 0
        ? runtimeState.operatingVoltageV
        : compiledPath?.supplyKind === "regulated-rail" &&
            compiledPath.regulatedVoltageV !== undefined
          ? compiledPath.regulatedVoltageV
          : batteryTerminalVoltageV !== undefined &&
              Number.isFinite(batteryTerminalVoltageV) &&
              batteryTerminalVoltageV > 0
            ? batteryTerminalVoltageV
            : robotConfig.battery?.nominalVoltageV;

    const voltageRatio =
      supplyV !== undefined && nominalV > 0
        ? Math.max(0, supplyV / nominalV)
        : 1.0;

    if (voltageRatio <= EPSILON) {
      warnings.push(
        `Drive motor "${motor.name}" on ${side} side has 0V effective supply.`
      );
      continue;
    }

    const effectiveMaxOmega = motor.noLoadAngularVelocityRadPerSec * voltageRatio;
    const effectiveLinearCap = resolvedRadiusM * effectiveMaxOmega;
    const torqueScale = runtimeState ? Math.max(0, runtimeState.torqueScaleFactor) : 1.0;

    if (runtimeState?.isCurrentLimited) {
      warnings.push(
        `Drive motor "${motor.name}" on ${side} side is currently limited by upstream driver or battery current limits.`
      );
    }

    poweredMotorCount += 1;
    minPoweredLinearMps = Math.min(minPoweredLinearMps, effectiveLinearCap);
    totalStallTorqueNm += motor.stallTorqueNm * voltageRatio * torqueScale;
  }

  const effectiveWheelRadiusM = radiusSum / sideWheels.length;
  const maxLinearVelocityMps =
    poweredMotorCount > 0 && Number.isFinite(minPoweredLinearMps)
      ? minPoweredLinearMps
      : 0;
  const maxWheelAngularVelocityRadPerSec =
    effectiveWheelRadiusM > 0 ? maxLinearVelocityMps / effectiveWheelRadiusM : 0;

  return {
    side,
    wheelCount: sideWheels.length,
    wheelIds,
    motorIds,
    effectiveWheelRadiusM,
    maxWheelAngularVelocityRadPerSec,
    maxLinearVelocityMps,
    totalStallTorqueNm,
    poweredMotorCount,
    isDrivable: poweredMotorCount > 0 && maxWheelAngularVelocityRadPerSec > EPSILON,
  };
}

/**
 * Builds a deterministic, physical/electrical-aware differential-drive control model
 * from a compiled `SimulationRobotConfig` without duplicating physics integration.
 */
export function createDifferentialDriveModel(params: {
  readonly robotConfig: SimulationRobotConfig | null | undefined;
  readonly runtimeElectricalState?: RuntimeElectricalState;
  readonly binding?: MotorHardwareBinding;
  readonly geometryOverride?: DifferentialDriveGeometryOverride;
  readonly batteryTerminalVoltageV?: number;
}): DifferentialDriveModel {
  const {
    robotConfig,
    runtimeElectricalState,
    binding,
    geometryOverride,
    batteryTerminalVoltageV,
  } = params;

  if (!robotConfig) {
    return createInvalidDifferentialDriveModel(
      "Differential-drive control requires a valid compiled robot configuration."
    );
  }

  const drivetrainType = robotConfig.drivetrain?.type;
  if (drivetrainType !== "differential-2" && drivetrainType !== "differential-4") {
    return createInvalidDifferentialDriveModel(
      `Unsupported drivetrain type "${String(drivetrainType)}" for differential-drive control.`
    );
  }

  const trackWidthM = geometryOverride?.trackWidthM ?? robotConfig.trackWidthM;
  if (!Number.isFinite(trackWidthM) || trackWidthM <= 0) {
    return createInvalidDifferentialDriveModel(
      `Invalid track width (${String(trackWidthM)}); trackWidthM must be positive and finite.`,
      drivetrainType
    );
  }

  const leftOverride =
    geometryOverride?.leftWheelRadiusM ?? geometryOverride?.wheelRadiusM;
  const rightOverride =
    geometryOverride?.rightWheelRadiusM ?? geometryOverride?.wheelRadiusM;

  if (
    (leftOverride !== undefined && (!Number.isFinite(leftOverride) || leftOverride <= 0)) ||
    (rightOverride !== undefined && (!Number.isFinite(rightOverride) || rightOverride <= 0))
  ) {
    return createInvalidDifferentialDriveModel(
      "Configured wheel radius override must be positive and finite.",
      drivetrainType
    );
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  if (binding && !binding.canDrive) {
    warnings.push(
      binding.faultReason ??
        "Hardware binding blocks drive actuation under current electrical state."
    );
  }

  const left = buildSideModel({
    side: "left",
    robotConfig,
    runtimeElectricalState,
    binding,
    explicitRadiusM: leftOverride,
    batteryTerminalVoltageV,
    warnings,
    errors,
  });

  const right = buildSideModel({
    side: "right",
    robotConfig,
    runtimeElectricalState,
    binding,
    explicitRadiusM: rightOverride,
    batteryTerminalVoltageV,
    warnings,
    errors,
  });

  if (errors.length > 0) {
    return {
      isValid: false,
      drivetrainType,
      trackWidthM,
      left,
      right,
      maxLinearVelocityMps: 0,
      maxAngularVelocityRadPerSec: 0,
      warnings: Array.from(new Set(warnings)),
      errors: Array.from(new Set(errors)),
    };
  }

  const bothDrivable = left.isDrivable && right.isDrivable;
  const maxLinearVelocityMps = bothDrivable
    ? Math.min(left.maxLinearVelocityMps, right.maxLinearVelocityMps)
    : 0;
  const maxAngularVelocityRadPerSec =
    bothDrivable && trackWidthM > 0
      ? (maxLinearVelocityMps * 2) / trackWidthM
      : 0;

  return {
    isValid: true,
    drivetrainType,
    trackWidthM,
    left,
    right,
    maxLinearVelocityMps,
    maxAngularVelocityRadPerSec,
    warnings: Array.from(new Set(warnings)),
    errors: [],
  };
}

function createZeroResolution(params: {
  readonly modelValid: boolean;
  readonly requestedLinearVelocityMps: number;
  readonly requestedAngularVelocityRadPerSec: number;
  readonly clampedNormalizedInput: boolean;
  readonly saturated: boolean;
  readonly warnings: readonly string[];
}): DifferentialDriveResolution {
  return {
    accepted: false,
    modelValid: params.modelValid,
    requestedLinearVelocityMps: params.requestedLinearVelocityMps,
    requestedAngularVelocityRadPerSec: params.requestedAngularVelocityRadPerSec,
    achievedLinearVelocityMps: 0,
    achievedAngularVelocityRadPerSec: 0,
    leftWheelAngularVelocityRadPerSec: 0,
    rightWheelAngularVelocityRadPerSec: 0,
    leftWheelLinearVelocityMps: 0,
    rightWheelLinearVelocityMps: 0,
    leftThrottle: 0,
    rightThrottle: 0,
    wheelTargets: [],
    saturated: params.saturated,
    saturationScale: 0,
    clampedNormalizedInput: params.clampedNormalizedInput,
    warnings: params.warnings,
  };
}

function buildPerWheelTargets(params: {
  readonly model: DifferentialDriveModel;
  readonly leftWheelLinearMps: number;
  readonly rightWheelLinearMps: number;
  readonly robotConfig?: SimulationRobotConfig | null;
}): readonly DifferentialWheelTarget[] {
  const { model, leftWheelLinearMps, rightWheelLinearMps, robotConfig } = params;

  if (!robotConfig || robotConfig.wheels.length === 0) {
    return [
      {
        wheelId: model.left.wheelIds[0] ?? "left-0",
        motorId: model.left.motorIds[0] ?? "left-motor-0",
        side: "left",
        slotIndex: 0,
        radiusM: model.left.effectiveWheelRadiusM,
        targetAngularVelocityRadPerSec: zeroIfTiny(
          leftWheelLinearMps / model.left.effectiveWheelRadiusM
        ),
        targetLinearVelocityMps: zeroIfTiny(leftWheelLinearMps),
      },
      {
        wheelId: model.right.wheelIds[0] ?? "right-0",
        motorId: model.right.motorIds[0] ?? "right-motor-0",
        side: "right",
        slotIndex: 0,
        radiusM: model.right.effectiveWheelRadiusM,
        targetAngularVelocityRadPerSec: zeroIfTiny(
          rightWheelLinearMps / model.right.effectiveWheelRadiusM
        ),
        targetLinearVelocityMps: zeroIfTiny(rightWheelLinearMps),
      },
    ];
  }

  return robotConfig.wheels.map((wheel: WheelSimulationConfig) => {
    const motor = robotConfig.motors.find(
      (item) => item.side === wheel.side && item.slotIndex === wheel.slotIndex
    );
    const linearMps =
      wheel.side === "left" ? leftWheelLinearMps : rightWheelLinearMps;
    const radiusM =
      wheel.side === "left"
        ? model.left.effectiveWheelRadiusM
        : model.right.effectiveWheelRadiusM;
    return {
      wheelId: wheel.wheelId,
      motorId: motor?.motorId ?? `${wheel.side}-motor-${wheel.slotIndex}`,
      side: wheel.side,
      slotIndex: wheel.slotIndex,
      radiusM,
      targetAngularVelocityRadPerSec:
        radiusM > 0 ? zeroIfTiny(linearMps / radiusM) : 0,
      targetLinearVelocityMps: zeroIfTiny(linearMps),
    };
  });
}

/**
 * Converts physical twist commands `(linearVelocityMps, angularVelocityRadPerSec)`
 * into left/right wheel angular targets and normalized throttles `[-1, 1]`, preserving
 * the intended curvature ratio under uniform command saturation.
 *
 * Sign convention matches drivetrainDynamics.ts (+X forward, +Y CCW yaw turning left):
 *   v_left  = v - (trackWidth / 2) * omega
 *   v_right = v + (trackWidth / 2) * omega
 */
export function computeDifferentialDriveTargetsFromTwist(params: {
  readonly model: DifferentialDriveModel;
  readonly command: DifferentialDriveTwistCommand;
  readonly robotConfig?: SimulationRobotConfig | null;
  readonly clampedNormalizedInput?: boolean;
  readonly extraWarnings?: readonly string[];
}): DifferentialDriveResolution {
  const {
    model,
    command,
    robotConfig,
    clampedNormalizedInput = false,
    extraWarnings = [],
  } = params;

  const warnings: string[] = [...extraWarnings];

  if (
    !Number.isFinite(command.linearVelocityMps) ||
    !Number.isFinite(command.angularVelocityRadPerSec)
  ) {
    warnings.push(
      "Non-finite twist velocity command rejected; robot targets reset safely to zero."
    );
    return createZeroResolution({
      modelValid: model.isValid,
      requestedLinearVelocityMps: 0,
      requestedAngularVelocityRadPerSec: 0,
      clampedNormalizedInput,
      saturated: false,
      warnings,
    });
  }

  if (!model.isValid) {
    warnings.push(...model.errors);
    return createZeroResolution({
      modelValid: false,
      requestedLinearVelocityMps: command.linearVelocityMps,
      requestedAngularVelocityRadPerSec: command.angularVelocityRadPerSec,
      clampedNormalizedInput,
      saturated: false,
      warnings,
    });
  }

  const reqV = zeroIfTiny(command.linearVelocityMps);
  const reqOmega = zeroIfTiny(command.angularVelocityRadPerSec);
  const halfTrack = model.trackWidthM / 2;

  const rawLeftLinear = reqV - halfTrack * reqOmega;
  const rawRightLinear = reqV + halfTrack * reqOmega;
  const rawLeftOmega = rawLeftLinear / model.left.effectiveWheelRadiusM;
  const rawRightOmega = rawRightLinear / model.right.effectiveWheelRadiusM;

  const leftCapOmega = model.left.maxWheelAngularVelocityRadPerSec;
  const rightCapOmega = model.right.maxWheelAngularVelocityRadPerSec;

  const leftScale =
    Math.abs(rawLeftOmega) > EPSILON
      ? leftCapOmega > EPSILON
        ? Math.min(1, leftCapOmega / Math.abs(rawLeftOmega))
        : 0
      : 1;

  const rightScale =
    Math.abs(rawRightOmega) > EPSILON
      ? rightCapOmega > EPSILON
        ? Math.min(1, rightCapOmega / Math.abs(rawRightOmega))
        : 0
      : 1;

  const saturationScale = Math.min(1, leftScale, rightScale);
  const saturated = saturationScale < 1 - 1e-7;

  if (saturated) {
    if (saturationScale === 0) {
      warnings.push(
        "Required drive channel has zero electrical/mechanical velocity capacity; twist command halted to preserve trajectory safety."
      );
    } else {
      warnings.push(
        `Velocity command saturated to ${(saturationScale * 100).toFixed(1)}% of requested speed while preserving intended curvature ratio.`
      );
    }
  }

  const leftWheelOmega = zeroIfTiny(rawLeftOmega * saturationScale);
  const rightWheelOmega = zeroIfTiny(rawRightOmega * saturationScale);
  const leftWheelLinear = zeroIfTiny(
    leftWheelOmega * model.left.effectiveWheelRadiusM
  );
  const rightWheelLinear = zeroIfTiny(
    rightWheelOmega * model.right.effectiveWheelRadiusM
  );

  const achievedLinearVelocityMps = zeroIfTiny(
    (leftWheelLinear + rightWheelLinear) / 2
  );
  const achievedAngularVelocityRadPerSec = zeroIfTiny(
    (rightWheelLinear - leftWheelLinear) / model.trackWidthM
  );

  const leftThrottle =
    leftCapOmega > EPSILON ? clampUnit(leftWheelOmega / leftCapOmega) : 0;
  const rightThrottle =
    rightCapOmega > EPSILON ? clampUnit(rightWheelOmega / rightCapOmega) : 0;

  return {
    accepted: model.left.isDrivable || model.right.isDrivable,
    modelValid: true,
    requestedLinearVelocityMps: reqV,
    requestedAngularVelocityRadPerSec: reqOmega,
    achievedLinearVelocityMps,
    achievedAngularVelocityRadPerSec,
    leftWheelAngularVelocityRadPerSec: leftWheelOmega,
    rightWheelAngularVelocityRadPerSec: rightWheelOmega,
    leftWheelLinearVelocityMps: leftWheelLinear,
    rightWheelLinearVelocityMps: rightWheelLinear,
    leftThrottle,
    rightThrottle,
    wheelTargets: buildPerWheelTargets({
      model,
      leftWheelLinearMps: leftWheelLinear,
      rightWheelLinearMps: rightWheelLinear,
      robotConfig,
    }),
    saturated,
    saturationScale,
    clampedNormalizedInput,
    warnings: Array.from(new Set(warnings)),
  };
}

/**
 * Resolves a normalized velocity command `(linear in [-1, 1], angular in [-1, 1])`
 * against the differential-drive capability envelope using identical inverse kinematics
 * and ratio-preserving saturation.
 */
export function computeDifferentialDriveTargetsFromNormalizedVelocity(params: {
  readonly model: DifferentialDriveModel;
  readonly command: NormalizedVelocityCommand;
  readonly robotConfig?: SimulationRobotConfig | null;
}): DifferentialDriveResolution {
  const { model, command, robotConfig } = params;
  const warnings: string[] = [];

  if (!Number.isFinite(command.linear) || !Number.isFinite(command.angular)) {
    warnings.push(
      "Non-finite normalized velocity command rejected; robot targets reset safely to zero."
    );
    return createZeroResolution({
      modelValid: model.isValid,
      requestedLinearVelocityMps: 0,
      requestedAngularVelocityRadPerSec: 0,
      clampedNormalizedInput: false,
      saturated: false,
      warnings,
    });
  }

  let clampedNormalizedInput = false;
  let normLinear = command.linear;
  let normAngular = command.angular;

  if (normLinear > 1 || normLinear < -1) {
    normLinear = clampUnit(normLinear);
    clampedNormalizedInput = true;
    warnings.push(
      `Normalized linear velocity ${command.linear.toFixed(2)} clamped to [${-1}, ${1}].`
    );
  }
  if (normAngular > 1 || normAngular < -1) {
    normAngular = clampUnit(normAngular);
    clampedNormalizedInput = true;
    warnings.push(
      `Normalized angular velocity ${command.angular.toFixed(2)} clamped to [${-1}, ${1}].`
    );
  }

  const requestedLinearVelocityMps =
    zeroIfTiny(normLinear) * model.maxLinearVelocityMps;
  const requestedAngularVelocityRadPerSec =
    zeroIfTiny(normAngular) * model.maxAngularVelocityRadPerSec;

  return computeDifferentialDriveTargetsFromTwist({
    model,
    command: {
      linearVelocityMps: requestedLinearVelocityMps,
      angularVelocityRadPerSec: requestedAngularVelocityRadPerSec,
    },
    robotConfig,
    clampedNormalizedInput,
    extraWarnings: warnings,
  });
}

/**
 * Pure forward-kinematics helper computing chassis `(linearVelocityMps, angularVelocityRadPerSec)`
 * from left and right wheel angular velocities (e.g. for kinematic validation or telemetry).
 */
export function computeChassisTwistFromWheelVelocities(
  model: DifferentialDriveModel,
  leftWheelAngularVelocityRadPerSec: number,
  rightWheelAngularVelocityRadPerSec: number
): DifferentialDriveTwistCommand {
  if (
    !model.isValid ||
    model.trackWidthM <= 0 ||
    !Number.isFinite(leftWheelAngularVelocityRadPerSec) ||
    !Number.isFinite(rightWheelAngularVelocityRadPerSec)
  ) {
    return { linearVelocityMps: 0, angularVelocityRadPerSec: 0 };
  }

  const vLeft =
    leftWheelAngularVelocityRadPerSec * model.left.effectiveWheelRadiusM;
  const vRight =
    rightWheelAngularVelocityRadPerSec * model.right.effectiveWheelRadiusM;

  return {
    linearVelocityMps: zeroIfTiny((vLeft + vRight) / 2),
    angularVelocityRadPerSec: zeroIfTiny((vRight - vLeft) / model.trackWidthM),
  };
}
