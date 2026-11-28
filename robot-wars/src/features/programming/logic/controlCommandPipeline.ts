import { validateElectricalAssembly } from "../../electrical/logic/electricalValidation";
import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import type { DrivetrainInput, SimulationRobotConfig } from "../../simulation/types/simulation.types";
import {
  computeDifferentialDriveTargetsFromNormalizedVelocity,
  computeDifferentialDriveTargetsFromTwist,
  createDifferentialDriveModel,
} from "./differentialDriveControl";
import type {
  CommandNormalizationResult,
  DifferentialDriveModel,
  DifferentialDriveResolution,
  MotorHardwareBinding,
  NormalizedDriveTarget,
  RobotActuatorCommand,
} from "../types/control.types";

export const NEUTRAL_NORMALIZED_TARGET: NormalizedDriveTarget = Object.freeze({
  leftPower: 0,
  rightPower: 0,
  lastCommandAtSeconds: 0,
  activeCommandKind: "none",
  clampedValues: false,
});

/**
 * Validates and clamps a raw scalar motor power command to [-1, 1].
 * Non-finite numbers reset safely to 0 with an explicit warning.
 */
export function normalizeCommandPower(rawPower: number): {
  readonly value: number;
  readonly clamped: boolean;
  readonly warning?: string;
} {
  if (typeof rawPower !== "number" || !Number.isFinite(rawPower)) {
    return {
      value: 0,
      clamped: true,
      warning: `Non-finite motor power (${String(rawPower)}) reset safely to 0.`,
    };
  }

  let clamped = false;
  let value = rawPower;
  if (value > 1) {
    value = 1;
    clamped = true;
  } else if (value < -1) {
    value = -1;
    clamped = true;
  }

  if (Math.abs(value) < 1e-6) {
    value = 0;
  }

  return {
    value,
    clamped,
    warning: clamped
      ? `Motor power ${rawPower.toFixed(2)} exceeded bounds [-1, 1] and was clamped to ${value.toFixed(2)}.`
      : undefined,
  };
}

/**
 * Resolves left/right motor channel bindings from compiled SimulationRobotConfig
 * and optional RobotPart + ElectricalConnection state without creating parallel stores.
 */
export function resolveRobotHardwareBinding(params: {
  readonly robotConfig: SimulationRobotConfig;
  readonly parts?: readonly RobotPart[];
  readonly electricalConnections?: readonly ElectricalConnection[];
  readonly trippedFuseIds?: readonly string[];
  readonly isBatteryCutoff?: boolean;
}): MotorHardwareBinding {
  const {
    robotConfig,
    parts = [],
    electricalConnections = [],
    trippedFuseIds,
    isBatteryCutoff = false,
  } = params;

  const leftMotorIds = (robotConfig.motors ?? [])
    .filter((m) => m.side === "left")
    .map((m) => m.motorId);
  const rightMotorIds = (robotConfig.motors ?? [])
    .filter((m) => m.side === "right")
    .map((m) => m.motorId);
  const hasLeftMotors = leftMotorIds.length > 0;
  const hasRightMotors = rightMotorIds.length > 0;
  const warnings: string[] = [];

  if (!hasLeftMotors) {
    warnings.push("No left drive motors bound in drivetrain configuration.");
  }
  if (!hasRightMotors) {
    warnings.push("No right drive motors bound in drivetrain configuration.");
  }

  if (isBatteryCutoff) {
    return {
      leftMotorIds,
      rightMotorIds,
      hasLeftMotors,
      hasRightMotors,
      canDrive: false,
      electricalMode: "electrical-fault",
      faultReason: "Battery low-voltage cutoff active.",
      warnings,
    };
  }

  if (parts.length === 0 || electricalConnections.length === 0) {
    return {
      leftMotorIds,
      rightMotorIds,
      hasLeftMotors,
      hasRightMotors,
      canDrive: hasLeftMotors || hasRightMotors,
      electricalMode: "mechanical-only",
      warnings,
    };
  }

  const report = validateElectricalAssembly({
    parts,
    electricalConnections,
    trippedFuseIds,
  });

  for (const diag of report.diagnostics) {
    if (diag.severity === "warning") {
      warnings.push(diag.title);
    }
  }

  const allMotorIds = new Set([...leftMotorIds, ...rightMotorIds]);
  const isMotorErrorDiag = (d: (typeof report.diagnostics)[number]) =>
    d.severity === "error" &&
    ((d.partId && allMotorIds.has(d.partId)) ||
      (d.relatedPartId && allMotorIds.has(d.relatedPartId)) ||
      d.code === "missing-component");

  const motorErrorDiag = report.diagnostics.find(isMotorErrorDiag);

  const motorStatesList = [...allMotorIds].map((motorId) => ({
    motorId,
    state: report.powerAnalysis?.consumerStates[motorId],
    directError: report.diagnostics.find(
      (d) =>
        d.severity === "error" &&
        (d.partId === motorId || d.relatedPartId === motorId)
    ),
  }));

  const healthyMotors = motorStatesList.filter(
    ({ state, directError }) =>
      !directError && Boolean(state && state.energized && !state.hasPathFault)
  );
  const faultedOrUnpoweredMotors = motorStatesList.filter(
    ({ state, directError }) =>
      Boolean(directError) || !state || !state.energized || state.hasPathFault
  );

  // Branch-local isolation: only block driving completely when ZERO bound drive motors are healthy
  // or a fatal missing-component error compromises the assembly. If one motor branch stays healthy,
  // allow actuation with explicit branch warnings while physics zeroes unpowered/faulted motors.
  const hasGlobalMissingComponentError = report.diagnostics.some(
    (d) => d.severity === "error" && d.code === "missing-component"
  );

  if (
    hasGlobalMissingComponentError ||
    (motorStatesList.length > 0 && healthyMotors.length === 0)
  ) {
    const firstFault = faultedOrUnpoweredMotors[0];
    const reason =
      motorErrorDiag?.title ??
      firstFault?.directError?.title ??
      (firstFault?.state?.hasPathFault
        ? firstFault.state.pathFaultReason ??
          `Drive motor "${firstFault.motorId}" has an electrical path fault.`
        : `Drive motor "${firstFault?.motorId}" has no energized power supply path in electrical wiring.`);
    return {
      leftMotorIds,
      rightMotorIds,
      hasLeftMotors,
      hasRightMotors,
      canDrive: false,
      electricalMode: "electrical-fault",
      faultReason: reason,
      warnings,
    };
  }

  for (const degraded of faultedOrUnpoweredMotors) {
    warnings.push(
      degraded.directError?.title ??
        degraded.state?.pathFaultReason ??
        `Drive motor "${degraded.motorId}" branch is currently unpowered or faulted; remaining healthy motors stay active.`
    );
  }

  return {
    leftMotorIds,
    rightMotorIds,
    hasLeftMotors,
    hasRightMotors,
    canDrive: hasLeftMotors || hasRightMotors,
    electricalMode: "electrically-verified",
    warnings,
  };
}

/**
 * Normalizes and validates an actuator command against hardware bindings,
 * returning bounded target powers and a physics-compatible DrivetrainInput.
 */
export function applyCommandToDriveTarget(params: {
  readonly current: NormalizedDriveTarget;
  readonly command: RobotActuatorCommand;
  readonly binding: MotorHardwareBinding;
  readonly timestampSeconds: number;
  readonly differentialModel?: DifferentialDriveModel;
  readonly robotConfig?: SimulationRobotConfig | null;
}): {
  readonly nextTarget: NormalizedDriveTarget;
  readonly drivetrainInput: DrivetrainInput;
  readonly result: CommandNormalizationResult;
  readonly differentialResolution?: DifferentialDriveResolution;
} {
  const {
    current,
    command,
    binding,
    timestampSeconds,
    differentialModel,
    robotConfig,
  } = params;
  const warnings: string[] = [];
  let leftPower = current.leftPower;
  let rightPower = current.rightPower;
  let clamped = false;
  let accepted = true;
  let differentialResolution: DifferentialDriveResolution | undefined;

  switch (command.kind) {
    case "stop-robot": {
      leftPower = 0;
      rightPower = 0;
      break;
    }
    case "stop-motors": {
      const target = command.target ?? "both";
      if (target === "left" || target === "both") leftPower = 0;
      if (target === "right" || target === "both") rightPower = 0;
      break;
    }
    case "set-motor-power": {
      const norm = normalizeCommandPower(command.power);
      if (norm.clamped) clamped = true;
      if (norm.warning) warnings.push(norm.warning);

      if (command.target === "left" || command.target === "both") {
        if (!binding.hasLeftMotors) {
          leftPower = 0;
          warnings.push("Ignored left power command: no left motor mounted/mapped.");
        } else {
          leftPower = norm.value;
        }
      }
      if (command.target === "right" || command.target === "both") {
        if (!binding.hasRightMotors) {
          rightPower = 0;
          warnings.push("Ignored right power command: no right motor mounted/mapped.");
        } else {
          rightPower = norm.value;
        }
      }
      break;
    }
    case "set-differential-drive": {
      const normL = normalizeCommandPower(command.leftPower);
      const normR = normalizeCommandPower(command.rightPower);
      clamped = normL.clamped || normR.clamped;
      if (normL.warning) warnings.push(normL.warning);
      if (normR.warning) warnings.push(normR.warning);

      leftPower = binding.hasLeftMotors ? normL.value : 0;
      rightPower = binding.hasRightMotors ? normR.value : 0;
      if (!binding.hasLeftMotors) {
        warnings.push("Left drive channel unavailable on current robot.");
      }
      if (!binding.hasRightMotors) {
        warnings.push("Right drive channel unavailable on current robot.");
      }
      break;
    }
    case "set-twist-velocity": {
      const model =
        differentialModel ??
        createDifferentialDriveModel({ robotConfig, binding });
      const res = computeDifferentialDriveTargetsFromTwist({
        model,
        command: {
          linearVelocityMps: command.linearVelocityMps,
          angularVelocityRadPerSec: command.angularVelocityRadPerSec,
        },
        robotConfig,
      });
      differentialResolution = res;
      leftPower = binding.hasLeftMotors ? res.leftThrottle : 0;
      rightPower = binding.hasRightMotors ? res.rightThrottle : 0;
      clamped = res.saturated;
      accepted = res.accepted;
      warnings.push(...res.warnings);
      break;
    }
    case "set-normalized-velocity": {
      const model =
        differentialModel ??
        createDifferentialDriveModel({ robotConfig, binding });
      const res = computeDifferentialDriveTargetsFromNormalizedVelocity({
        model,
        command: {
          linear: command.linear,
          angular: command.angular,
        },
        robotConfig,
      });
      differentialResolution = res;
      leftPower = binding.hasLeftMotors ? res.leftThrottle : 0;
      rightPower = binding.hasRightMotors ? res.rightThrottle : 0;
      clamped = res.saturated || res.clampedNormalizedInput;
      accepted = res.accepted;
      warnings.push(...res.warnings);
      break;
    }
    case "extensible-actuator": {
      // Reserved channel hook cleanly acknowledged without interfering with differential drive
      accepted = true;
      break;
    }
  }

  if (!binding.canDrive) {
    leftPower = 0;
    rightPower = 0;
    accepted = command.kind === "stop-robot" || command.kind === "stop-motors";
    if (binding.faultReason && !accepted) {
      warnings.push(`Actuation blocked: ${binding.faultReason}`);
    }
  }

  const nextTarget: NormalizedDriveTarget = {
    leftPower,
    rightPower,
    lastCommandAtSeconds: timestampSeconds,
    activeCommandKind: command.kind,
    clampedValues: clamped,
  };

  const drivetrainInput: DrivetrainInput = {
    leftThrottle: leftPower,
    rightThrottle: rightPower,
  };

  return {
    nextTarget,
    drivetrainInput,
    result: {
      accepted,
      leftPower,
      rightPower,
      clamped,
      warnings,
    },
    ...(differentialResolution && { differentialResolution }),
  };
}
