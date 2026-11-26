/**
 * Pure simulation configuration compiler for Robot Wars.
 *
 * Compiles a validated, immutable SimulationRobotConfig from Robot Builder assembly data,
 * connections, and drivetrain configuration.
 *
 * NOTE: This is a pure analytical compiler with zero side effects.
 * It never mutates input parts, catalogue data, or store state.
 */

import {
  resolveBatteryEngineeringSpec,
  resolveMotorEngineeringSpec,
  resolveWheelEngineeringSpec,
} from "../../robot-builder/logic/engineeringAdapters";
import { resolvePartElectricalSpec } from "../../electrical/logic/electricalComponentAdapters";
import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import { resolveWheelDimensions } from "../../robot-builder/logic/geometryAdapters";
import { resolveAssemblyMass } from "../../robot-builder/logic/massResolvers";
import {
  compileRobotInertiaProfile,
  type RobotInertiaProfile,
} from "../../robot-builder/logic/robotInertia";
import {
  compileRobotStabilityProfile,
  type RobotStabilityProfile,
} from "../../robot-builder/logic/robotStability";
import {
  getDrivetrainSlotCount,
  validateDrivetrain,
} from "../../robot-builder/logic/drivetrain";
import type {
  DrivetrainConfiguration,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../../robot-builder/types/robot.types";
import type {
  BatterySimulationConfig,
  MotorSimulationConfig,
  NormalLoadBaseline,
  SimulationAssumption,
  SimulationConfigCompilationResult,
  SimulationRobotConfig,
  WheelSimulationConfig,
} from "../types/simulation.types";
import { compileElectricalSimulationProfile } from "./electricalSimulationCompiler";
import { DEFAULT_GROUND_SURFACE } from "./surfaceModel";

export interface CompileSimulationConfigOptions {
  readonly parts: readonly RobotPart[];
  readonly connections: readonly RobotConnection[];
  readonly drivetrain: DrivetrainConfiguration | null;
  readonly foundation?: FoundationConfig | null;
  readonly electricalConnections?: readonly ElectricalConnection[];
  readonly stabilityProfile?: RobotStabilityProfile;
  readonly inertiaProfile?: RobotInertiaProfile;
}

function isCompileOptions(
  input: readonly RobotPart[] | CompileSimulationConfigOptions
): input is CompileSimulationConfigOptions {
  return typeof input === "object" && input !== null && !Array.isArray(input) && "parts" in input;
}

/**
 * Pure compiler that derives an immutable SimulationRobotConfig from Robot Builder assembly data.
 */
export function compileSimulationConfig(
  partsOrOptions: readonly RobotPart[] | CompileSimulationConfigOptions,
  connectionsArg?: readonly RobotConnection[],
  drivetrainArg?: DrivetrainConfiguration | null,
  foundationArg?: FoundationConfig | null,
  stabilityProfileArg?: RobotStabilityProfile,
  inertiaProfileArg?: RobotInertiaProfile
): SimulationConfigCompilationResult {
  // Normalize arguments
  let parts: readonly RobotPart[];
  let connections: readonly RobotConnection[];
  let drivetrain: DrivetrainConfiguration | null;
  let foundation: FoundationConfig | null | undefined;
  let electricalConnections: readonly ElectricalConnection[] | undefined;
  let stabilityProfile: RobotStabilityProfile | undefined;
  let inertiaProfile: RobotInertiaProfile | undefined;

  if (isCompileOptions(partsOrOptions)) {
    parts = partsOrOptions.parts;
    connections = partsOrOptions.connections;
    drivetrain = partsOrOptions.drivetrain;
    foundation = partsOrOptions.foundation;
    electricalConnections = partsOrOptions.electricalConnections;
    stabilityProfile = partsOrOptions.stabilityProfile;
    inertiaProfile = partsOrOptions.inertiaProfile;
  } else {
    parts = partsOrOptions;
    connections = connectionsArg ?? [];
    drivetrain = drivetrainArg ?? null;
    foundation = foundationArg;
    stabilityProfile = stabilityProfileArg;
    inertiaProfile = inertiaProfileArg;
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const assumptions: SimulationAssumption[] = [];

  // 1. Guard against empty parts
  if (!parts || parts.length === 0) {
    errors.push("Assembly contains no components.");
    return {
      success: false,
      config: null,
      errors,
      warnings,
      assumptions,
    };
  }

  // 2. Guard against missing or unconfigured drivetrain
  if (!drivetrain) {
    errors.push("No drivetrain configuration provided for simulation.");
    return {
      success: false,
      config: null,
      errors,
      warnings,
      assumptions,
    };
  }

  const leftAssignments = drivetrain.left.filter(Boolean);
  const rightAssignments = drivetrain.right.filter(Boolean);

  if (leftAssignments.length === 0 || rightAssignments.length === 0) {
    errors.push("Drivetrain must have at least one powered wheel assignment on both left and right sides.");
    return {
      success: false,
      config: null,
      errors,
      warnings,
      assumptions,
    };
  }

  // 3. Drivetrain structural validation
  const requiredSlotCount = getDrivetrainSlotCount(drivetrain.type);
  if (leftAssignments.length !== requiredSlotCount || rightAssignments.length !== requiredSlotCount) {
    errors.push(
      `${drivetrain.type} requires ${requiredSlotCount} powered wheel assembly per side (found ${leftAssignments.length} left, ${rightAssignments.length} right).`
    );
  }

  // Duplicate assignment checks
  const assignedMotorIds = new Set<string>();
  const assignedWheelIds = new Set<string>();

  for (const side of ["left", "right"] as const) {
    for (const a of drivetrain[side]) {
      if (!a) continue;
      if (assignedMotorIds.has(a.motorId)) {
        errors.push(`Motor ${a.motorId} is assigned more than once in the drivetrain.`);
      } else {
        assignedMotorIds.add(a.motorId);
      }
      if (assignedWheelIds.has(a.wheelId)) {
        errors.push(`Wheel ${a.wheelId} is assigned more than once in the drivetrain.`);
      } else {
        assignedWheelIds.add(a.wheelId);
      }
    }
  }

  // Physical connection check
  if (connections.length > 0) {
    const motorWheelConnections = new Set(
      connections
        .filter((c) => c.type === "Motor-Wheel")
        .map((c) => `${c.parentId ?? c.sourceId}:${c.childId ?? c.targetId}`)
    );

    for (const side of ["left", "right"] as const) {
      for (const a of drivetrain[side]) {
        if (!a) continue;
        if (!motorWheelConnections.has(`${a.motorId}:${a.wheelId}`)) {
          errors.push(
            `Motor ${a.motorId} does not have a physical Motor-Wheel connection to wheel ${a.wheelId}.`
          );
        }
      }
    }
  }

  // Foundation mount validation when foundation is present
  if (foundation && parts.some((p) => p.id === "foundation-chassis")) {
    const drivetrainValidation = validateDrivetrain(
      drivetrain,
      parts as RobotPart[],
      connections as RobotConnection[],
      foundation
    );
    if (!drivetrainValidation.isValid) {
      for (const err of drivetrainValidation.errors) {
        errors.push(`Drivetrain validation error: ${err}`);
      }
    }
  }

  // 4. Mass Resolution
  const assemblyMass = resolveAssemblyMass(parts);
  const totalMassKg = assemblyMass.totalMassKg;

  if (totalMassKg <= 0 || !Number.isFinite(totalMassKg)) {
    errors.push("Robot assembly has zero or non-positive total mass.");
  }
  for (const inv of assemblyMass.invalidComponents) {
    if (inv.warning) {
      warnings.push(inv.warning);
    }
  }

  // 5. Center of Mass & Static Stability
  const stability =
    stabilityProfile ??
    compileRobotStabilityProfile(
      parts as RobotPart[],
      connections as RobotConnection[],
      drivetrain
    );

  const centerOfMass = {
    x: stability.centerOfMass.x,
    y: stability.centerOfMass.y,
    z: stability.centerOfMass.z,
  };

  if (stability.validity === "invalid" || stability.validity === "unsupported") {
    warnings.push(
      `Static stability calculation is ${stability.validity}; normal load distribution may be compromised.`
    );
  }

  // 6. Rotational Yaw Inertia (Iyy)
  const inertia =
    inertiaProfile ??
    compileRobotInertiaProfile(
      parts as RobotPart[],
      drivetrain,
      stability.centerOfMass
    );

  const yawInertiaKgM2 = inertia.bodyMomentsOfInertia.iyy;

  if (yawInertiaKgM2 <= 0 || !Number.isFinite(yawInertiaKgM2)) {
    errors.push("Rotational yaw inertia (Iyy) must be strictly positive and finite.");
  }
  if (inertia.validity === "marginal") {
    warnings.push("Rotational inertia profile is marginal; some component inertias were approximated.");
  }

  // 7. Track Width & Wheelbase Resolution
  const partsById = new Map(parts.map((p) => [p.id, p]));

  const leftWheelParts: RobotPart[] = [];
  const rightWheelParts: RobotPart[] = [];

  for (const assignment of leftAssignments) {
    if (assignment) {
      const w = partsById.get(assignment.wheelId);
      if (w) leftWheelParts.push(w);
    }
  }
  for (const assignment of rightAssignments) {
    if (assignment) {
      const w = partsById.get(assignment.wheelId);
      if (w) rightWheelParts.push(w);
    }
  }

  let trackWidthM = 0;
  if (leftWheelParts.length > 0 && rightWheelParts.length > 0) {
    const avgLeftZ =
      leftWheelParts.reduce((sum, w) => sum + w.position[2], 0) /
      leftWheelParts.length;
    const avgRightZ =
      rightWheelParts.reduce((sum, w) => sum + w.position[2], 0) /
      rightWheelParts.length;
    trackWidthM = Math.abs(avgLeftZ - avgRightZ);
  }

  if (trackWidthM < 0.01) {
    errors.push("Drivetrain track width is degenerate (< 0.01 m).");
  }

  let wheelbaseM: number | null = null;
  if (drivetrain.type === "differential-4") {
    const allDrivenWheels = [...leftWheelParts, ...rightWheelParts];
    const xCoords = allDrivenWheels.map((w) => w.position[0]);
    if (xCoords.length > 0) {
      const minX = Math.min(...xCoords);
      const maxX = Math.max(...xCoords);
      const deltaX = maxX - minX;
      wheelbaseM = deltaX >= 0.005 ? deltaX : 0;
      if (wheelbaseM === 0) {
        warnings.push("4WD wheelbase is negligible (< 0.005 m); axles appear co-located.");
      }
    }
  } else {
    // 2WD configuration: single driven axle
    wheelbaseM = null;
    assumptions.push({
      id: "2wd-passive-support",
      parameter: "drivetrain.passiveContact",
      value: true,
      source: "derived-heuristic",
      description:
        "2WD configuration relies on passive chassis skid or caster contact for static pitch stability.",
    });
  }

  // 8. Motor Configurations Compilation
  const compiledMotors: MotorSimulationConfig[] = [];

  for (const side of ["left", "right"] as const) {
    const assignments = drivetrain[side];
    for (let slotIndex = 0; slotIndex < assignments.length; slotIndex++) {
      const assignment = assignments[slotIndex];
      if (!assignment) continue;

      const motor = partsById.get(assignment.motorId);
      if (!motor) {
        errors.push(
          `Motor ${assignment.motorId} assigned to ${side} drivetrain slot ${
            slotIndex + 1
          } was not found in assembly.`
        );
        continue;
      }

      const motorSpec = resolveMotorEngineeringSpec(motor);
      const stallTorqueNm = motorSpec.mechanical?.stallTorqueNm;
      const noLoadRpm = motorSpec.mechanical?.noLoadSpeedRpm;

      if (stallTorqueNm === undefined || stallTorqueNm <= 0 || !Number.isFinite(stallTorqueNm)) {
        errors.push(
          `Motor "${motor.name}" (${motor.id}) lacks valid positive stall torque.`
        );
      }
      if (noLoadRpm === undefined || noLoadRpm <= 0 || !Number.isFinite(noLoadRpm)) {
        errors.push(
          `Motor "${motor.name}" (${motor.id}) lacks valid positive no-load RPM.`
        );
      }

      const validTorque = stallTorqueNm ?? 0;
      const validRpm = noLoadRpm ?? 0;
      const noLoadAngularVelocityRadPerSec = (validRpm * 2 * Math.PI) / 60;

      const prov = motorSpec.mechanical?.provenance;
      const isVerified = Boolean(prov && "verified" in prov && prov.verified);
      const source =
        (prov && "source" in prov && prov.source) ||
        (prov && "basis" in prov && prov.basis) ||
        `catalogue:motor:${motor.motorCatalogueId ?? "custom"}`;

      if (!isVerified) {
        assumptions.push({
          id: `motor-${motor.id}-mechanical-unverified`,
          parameter: `motor.${motor.id}.mechanical`,
          value: `${validRpm} RPM, ${validTorque} N·m`,
          source: "catalogue-unverified",
          description: `Motor "${motor.name}" mechanical properties are catalogue presets without verified datasheet verification.`,
        });
      }

      if (motorSpec.electrical?.nominalVoltageV === undefined) {
        assumptions.push({
          id: `motor-${motor.id}-voltage-omitted`,
          parameter: `motor.${motor.id}.nominalVoltageV`,
          value: "omitted",
          source: "catalogue-unverified",
          description: `Motor "${motor.name}" omits an electrical nominal voltage rating; simulation scales voltage against installed battery nominal voltage unless electrical ratings are specified.`,
        });
      }

      compiledMotors.push({
        motorId: motor.id,
        name: motor.name,
        side,
        slotIndex,
        stallTorqueNm: validTorque,
        noLoadRpm: validRpm,
        noLoadAngularVelocityRadPerSec,
        nominalVoltageV: motorSpec.electrical?.nominalVoltageV,
        ratedCurrentA: motorSpec.electrical?.ratedCurrentA,
        stallCurrentA: motorSpec.electrical?.stallCurrentA,
        noLoadCurrentA: motorSpec.electrical?.noLoadCurrentA,
        electricalSpecId: motor.electricalSpec?.specId ?? motor.electricalCatalogueId,
        provenance: {
          source,
          verified: isVerified,
          notes: prov?.notes,
        },
      });
    }
  }

  // 9. Wheel Configurations Compilation
  const compiledWheels: WheelSimulationConfig[] = [];

  for (const side of ["left", "right"] as const) {
    const assignments = drivetrain[side];
    for (let slotIndex = 0; slotIndex < assignments.length; slotIndex++) {
      const assignment = assignments[slotIndex];
      if (!assignment) continue;

      const wheel = partsById.get(assignment.wheelId);
      if (!wheel) {
        errors.push(
          `Wheel ${assignment.wheelId} assigned to ${side} drivetrain slot ${
            slotIndex + 1
          } was not found in assembly.`
        );
        continue;
      }

      const wheelRes = resolveWheelDimensions(wheel);
      if (!wheelRes.isValid || wheelRes.diameterM <= 0) {
        errors.push(
          `Wheel "${wheel.name}" (${wheel.id}) has invalid diameter (${wheelRes.diameterM} m): ${
            wheelRes.failureReason ?? "unknown"
          }.`
        );
      }

      const wheelSpec = resolveWheelEngineeringSpec(wheel);
      const staticFrictionCoeff = wheelSpec.traction?.staticFrictionCoeff;

      if (staticFrictionCoeff === undefined) {
        assumptions.push({
          id: `wheel-${wheel.id}-friction-default`,
          parameter: `wheel.${wheel.id}.staticFrictionCoeff`,
          value: DEFAULT_GROUND_SURFACE.staticFrictionCoeff,
          unit: "dimensionless",
          source: "standard-default",
          description: `Static friction coefficient for "${wheel.name}" was unspecified; simulation assumes nominal rubber-on-steel default (${DEFAULT_GROUND_SURFACE.staticFrictionCoeff}).`,
        });
      }

      const perWheelLoad = stability.wheelLoadDistribution.perWheelLoads.find(
        (pw) => pw.partId === wheel.id
      );

      compiledWheels.push({
        wheelId: wheel.id,
        name: wheel.name,
        side,
        slotIndex,
        diameterM: wheelRes.diameterM,
        radiusM: wheelRes.radiusM,
        widthM: wheelRes.widthM,
        staticFrictionCoeff,
        normalLoadN: perWheelLoad?.normalForceN,
        localPosition:
          Number.isFinite(wheel.position[0]) && Number.isFinite(wheel.position[2])
            ? { x: wheel.position[0], z: wheel.position[2] }
            : undefined,
        provenance: {
          source: wheelRes.source,
          verified: wheelRes.source === "canonical-cylinder",
          notes: wheelRes.warning,
        },
      });
    }
  }

  // 10. Battery Resolution
  const batteryPart = parts.find((p) => p.type === "Battery");
  let batteryConfig: BatterySimulationConfig | null = null;

  if (!batteryPart) {
    errors.push(
      "No battery installed in robot assembly. Dynamic drivetrain simulation requires a power source."
    );
  } else {
    const batterySpec = resolveBatteryEngineeringSpec(batteryPart);
    const elecBat = resolvePartElectricalSpec(batteryPart)?.batterySpec;
    const nominalVoltageV = batterySpec.electrical?.nominalVoltageV;

    if (nominalVoltageV === undefined || nominalVoltageV <= 0 || !Number.isFinite(nominalVoltageV)) {
      errors.push(
        `Battery "${batteryPart.name}" (${batteryPart.id}) lacks valid nominal voltage.`
      );
    }

    const explicitInternalR =
      batterySpec.electrical?.internalResistanceOhm ?? elecBat?.internalResistanceOhm;
    const capacityMah = batterySpec.electrical?.capacityMah ?? elecBat?.capacityMah;
    const maxContinuousDischargeA =
      elecBat?.maxContinuousDischargeA ??
      (batterySpec.electrical?.continuousDischargeC !== undefined &&
      capacityMah !== undefined
        ? (capacityMah / 1000) * batterySpec.electrical.continuousDischargeC
        : undefined);
    const peakDischargeA =
      elecBat?.peakDischargeA ??
      (batterySpec.electrical?.burstDischargeC !== undefined &&
      capacityMah !== undefined
        ? (capacityMah / 1000) * batterySpec.electrical.burstDischargeC
        : undefined);

    if (explicitInternalR === undefined) {
      assumptions.push({
        id: `battery-${batteryPart.id}-internal-resistance-omitted`,
        parameter: `battery.${batteryPart.id}.internalResistanceOhm`,
        value: "omitted",
        source: "catalogue-unverified",
        description: `Battery "${batteryPart.name}" catalogue definition omits internal resistance and C-ratings to prevent fabrication; simulation uses standard default internal resistance unless configured explicitly.`,
      });
    }

    const batteryProv = batterySpec.electrical?.provenance;
    const batteryIsVerified = Boolean(batteryProv && "verified" in batteryProv && batteryProv.verified);
    const batterySource =
      (batteryProv && "source" in batteryProv && batteryProv.source) ||
      (batteryProv && "basis" in batteryProv && batteryProv.basis) ||
      `catalogue:battery:${batteryPart.batteryCatalogueId ?? "custom"}`;

    batteryConfig = {
      batteryId: batteryPart.id,
      name: batteryPart.name,
      chemistry: batterySpec.chemistry,
      cellCountS: batterySpec.cellCountS,
      nominalVoltageV: nominalVoltageV ?? 0,
      fullyChargedVoltageV: batterySpec.electrical?.fullyChargedVoltageV,
      cutoffVoltageV: batterySpec.electrical?.cutoffVoltageV,
      capacityMah,
      maxContinuousDischargeA,
      peakDischargeA,
      internalResistanceOhm: explicitInternalR,
      provenance: {
        source: batterySource,
        verified: batteryIsVerified,
        notes: batteryProv?.notes,
      },
    };
  }

  // 10b. Electrical System Compilation (only when logical ElectricalConnections exist)
  const compiledElectrical = compileElectricalSimulationProfile({
    parts,
    electricalConnections,
    compiledMotors,
  });
  if (compiledElectrical?.unmappedWarnings.length) {
    warnings.push(...compiledElectrical.unmappedWarnings);
  }
  if (compiledElectrical?.hasUnknownAuxiliaryLoad) {
    assumptions.push({
      id: "electrical-unknown-aux-load",
      parameter: "electrical.auxiliaryLoadA",
      value: "partial-unknown",
      source: "catalogue-unverified",
      description:
        "One or more wired non-motor consumers omit current ratings; unverified loads are omitted from battery sag rather than fabricated.",
    });
  }

  // 11. Normal Load Baseline
  let normalLoads: NormalLoadBaseline | null = null;
  if (stability.wheelLoadDistribution.validity === "valid" || stability.wheelLoadDistribution.validity === "marginal") {
    normalLoads = {
      totalNormalForceN: stability.wheelLoadDistribution.totalNormalForceN,
      leftSideNormalForceN: stability.wheelLoadDistribution.leftLoadN ?? 0,
      rightSideNormalForceN: stability.wheelLoadDistribution.rightLoadN ?? 0,
      perWheelLoads: stability.wheelLoadDistribution.perWheelLoads.map((pw) => ({
        wheelId: pw.partId,
        normalForceN: pw.normalForceN,
        isDriven: pw.isDriven,
      })),
    };
  }

  // Deduplicate assumptions by ID
  const uniqueAssumptions = Array.from(
    new Map(assumptions.map((a) => [a.id, a])).values()
  );

  // 12. Evaluate compilation success
  if (errors.length > 0) {
    return {
      success: false,
      config: null,
      errors: Array.from(new Set(errors)),
      warnings: Array.from(new Set(warnings)),
      assumptions: uniqueAssumptions,
    };
  }

  const validity = warnings.length > 0 ? "marginal" : "valid";

  const config: SimulationRobotConfig = {
    totalMassKg,
    centerOfMass,
    yawInertiaKgM2,
    trackWidthM,
    wheelbaseM,
    drivetrain: {
      type: drivetrain.type,
      drivenWheelCount: compiledWheels.length,
      leftSlotCount: leftAssignments.length,
      rightSlotCount: rightAssignments.length,
    },
    motors: compiledMotors,
    wheels: compiledWheels,
    battery: batteryConfig,
    electrical: compiledElectrical,
    normalLoads,
    assumptions: uniqueAssumptions,
    validity,
    warnings: Array.from(new Set(warnings)),
  };

  return {
    success: true,
    config,
    errors: [],
    warnings: Array.from(new Set(warnings)),
    assumptions: uniqueAssumptions,
  };
}
