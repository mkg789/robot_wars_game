/**
 * Reusable scenario builders and validation diagnostic helpers for Phase 4.1.5.
 *
 * Strictly for simulation validation testing. Uses only the real robot-builder
 * catalogues, simulationConfigCompiler, arenaModel, collisionModel, collisionResponse,
 * and simulationRunner pipeline without duplicating or mocking physics.
 */

import { expect } from "vitest";
import { batteryCatalogue } from "../../robot-builder/data/batteryCatalogue";
import { foundationModels } from "../../robot-builder/data/foundationModels";
import { motorCatalogue } from "../../robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../../robot-builder/data/wheelCatalogue";
import { generateMotorMountZones } from "../../robot-builder/logic/mountingZones";
import type {
  BatteryCatalogueId,
  DrivetrainConfiguration,
  DrivetrainType,
  FoundationConfig,
  FoundationModelId,
  MotorCatalogueId,
  RobotConnection,
  RobotPart,
  WheelCatalogueId,
} from "../../robot-builder/types/robot.types";
import type {
  DrivetrainInput,
  SimulationAdvanceResult,
  SimulationRobotConfig,
  SimulationRunnerOptions,
  SimulationRunnerState,
  SimulationState,
} from "../types/simulation.types";
import { compileSimulationConfig } from "./simulationConfigCompiler";
import {
  advanceSimulation,
  createInitialRunnerState,
} from "./simulationRunner";

export interface BuildCompiledRobotOptions {
  readonly drivetrainType?: DrivetrainType;
  readonly foundationModelId?: FoundationModelId;
  readonly chassisMassKg?: number;
  readonly motorId?: MotorCatalogueId;
  readonly wheelId?: WheelCatalogueId;
  readonly batteryId?: BatteryCatalogueId;
  readonly extraMassBlocks?: readonly {
    readonly id?: string;
    readonly massKg: number;
    readonly position: [number, number, number];
    readonly size?: [number, number, number];
  }[];
}

/**
 * Assembles a real catalogue-backed robot and compiles it through compileSimulationConfig.
 */
export function buildCompiledCatalogueRobot(
  options: BuildCompiledRobotOptions = {}
): SimulationRobotConfig {
  const drivetrainType = options.drivetrainType ?? "differential-4";
  const foundationModelId = options.foundationModelId ?? "compact-square";
  const motorCatId = options.motorId ?? "standard-dc";
  const wheelCatId = options.wheelId ?? "standard-rubber";
  const batteryCatId = options.batteryId ?? "standard-lipo";

  const foundationDef = foundationModels.find((f) => f.id === foundationModelId);
  const motorDef = motorCatalogue.find((m) => m.id === motorCatId);
  const wheelDef = wheelCatalogue.find((w) => w.id === wheelCatId);
  const batteryDef = batteryCatalogue.find((b) => b.id === batteryCatId);

  if (!foundationDef || !motorDef || !wheelDef || !batteryDef) {
    throw new Error("Missing required catalogue definition for test robot assembly.");
  }

  const chassisMassKg = options.chassisMassKg ?? 4.0;
  const chassisY = wheelDef.diameter / 2 + foundationDef.height / 2;
  const halfTrack = foundationDef.width / 2;
  const wheelOffsetZ = halfTrack + wheelDef.width / 2;

  const foundation: FoundationConfig = {
    modelId: foundationDef.id,
    length: foundationDef.length,
    width: foundationDef.width,
    height: foundationDef.height,
    includeTopPlate: false,
    includeFrontCover: false,
    confirmed: true,
  };

  const mountZones = generateMotorMountZones(foundation);
  const zoneById = new Map(mountZones.map((z) => [z.id, z]));

  const parts: RobotPart[] = [
    {
      id: "foundation-chassis",
      name: foundationDef.name,
      type: "Structural Block",
      foundationModelId: foundationDef.id,
      position: [0, chassisY, 0],
      rotation: [0, 0, 0],
      size: [foundationDef.length, foundationDef.height, foundationDef.width],
      color: "#334155",
      mass: chassisMassKg,
      massKg: chassisMassKg,
      geometry: { ...foundationDef.geometry },
    },
    {
      id: "battery-1",
      name: batteryDef.name,
      type: "Battery",
      batteryCatalogueId: batteryDef.id,
      position: [0, chassisY + foundationDef.height / 2 + batteryDef.dimensions.height / 2, 0],
      rotation: [0, 0, 0],
      size: [
        batteryDef.dimensions.length,
        batteryDef.dimensions.height,
        batteryDef.dimensions.width,
      ],
      color: batteryDef.color,
      mass: batteryDef.massKg,
      massKg: batteryDef.massKg,
      geometry: { ...batteryDef.geometry },
      electrical: { ...batteryDef.electrical },
      engineeringSpec: batteryDef.engineeringSpec,
    },
  ];

  if (options.extraMassBlocks) {
    options.extraMassBlocks.forEach((block, index) => {
      const size = block.size ?? [0.2, 0.2, 0.2];
      parts.push({
        id: block.id ?? `payload-block-${index}`,
        name: `Payload Mass Block ${index + 1}`,
        type: "Structural Block",
        position: block.position,
        rotation: [0, 0, 0],
        size,
        color: "#64748b",
        mass: block.massKg,
        massKg: block.massKg,
        geometry: {
          shape: "box",
          length: size[0],
          height: size[1],
          width: size[2],
        },
      });
    });
  }

  const connections: RobotConnection[] = [];
  const leftAssignments: { motorId: string; wheelId: string }[] = [];
  const rightAssignments: { motorId: string; wheelId: string }[] = [];

  const slots =
    drivetrainType === "differential-4"
      ? [
          { slot: "front-left", side: "left" as const, zSign: 1 },
          { slot: "rear-left", side: "left" as const, zSign: 1 },
          { slot: "front-right", side: "right" as const, zSign: -1 },
          { slot: "rear-right", side: "right" as const, zSign: -1 },
        ]
      : [
          { slot: "front-left", side: "left" as const, zSign: 1 },
          { slot: "front-right", side: "right" as const, zSign: -1 },
        ];

  for (const s of slots) {
    const zone = zoneById.get(s.slot);
    if (!zone) {
      throw new Error(`Missing motor mount zone: ${s.slot}`);
    }

    const motorId = `motor-${s.slot}`;
    const wheelId = `wheel-${s.slot}`;
    const mechConnId = `conn-chassis-${motorId}`;
    const motorWheelConnId = `conn-${motorId}-${wheelId}`;
    const axleX = drivetrainType === "differential-4" ? zone.position[0] : 0;

    parts.push({
      id: motorId,
      name: `${motorDef.name} (${s.slot})`,
      type: "Motor",
      motorCatalogueId: motorDef.id,
      mountingZoneId: zone.id,
      parentAttachmentId: mechConnId,
      position: [axleX, wheelDef.diameter / 2, s.zSign * (halfTrack - motorDef.dimensions[2] / 2)],
      rotation: [...zone.rotation],
      size: [...motorDef.dimensions],
      color: motorDef.color,
      mass: motorDef.massKg,
      massKg: motorDef.massKg,
      geometry: { ...motorDef.geometry },
      mechanical: { ...motorDef.mechanical },
      engineeringSpec: motorDef.engineeringSpec,
    });

    parts.push({
      id: wheelId,
      name: `${wheelDef.name} (${s.slot})`,
      type: "Wheel",
      wheelCatalogueId: wheelDef.id,
      parentAttachmentId: motorWheelConnId,
      position: [axleX, wheelDef.diameter / 2, s.zSign * wheelOffsetZ],
      rotation: [0, 0, 0],
      size: [wheelDef.diameter, wheelDef.width, wheelDef.diameter],
      color: wheelDef.color,
      mass: wheelDef.massKg,
      massKg: wheelDef.massKg,
      geometry: { ...wheelDef.geometry },
      engineeringSpec: wheelDef.engineeringSpec,
    });

    connections.push({
      id: mechConnId,
      type: "Mechanical",
      sourceId: "foundation-chassis",
      targetId: motorId,
      parentId: "foundation-chassis",
      childId: motorId,
      parentMountPointId: zone.id,
      childMountPointId: "housing",
      relativePosition: [0, 0, 0],
      relativeRotation: [0, 0, 0],
    });

    connections.push({
      id: motorWheelConnId,
      type: "Motor-Wheel",
      sourceId: motorId,
      targetId: wheelId,
      parentId: motorId,
      childId: wheelId,
      parentMountPointId: "motor-shaft",
      childMountPointId: "wheel-hub",
      relativePosition: [0, 0, 0],
      relativeRotation: [0, 0, 0],
    });

    if (s.side === "left") {
      leftAssignments.push({ motorId, wheelId });
    } else {
      rightAssignments.push({ motorId, wheelId });
    }
  }

  const drivetrain: DrivetrainConfiguration = {
    type: drivetrainType,
    left: leftAssignments,
    right: rightAssignments,
    mappingCustomized: false,
  };

  const compiled = compileSimulationConfig({
    parts,
    connections,
    drivetrain,
    foundation,
  });

  if (!compiled.success || !compiled.config) {
    throw new Error(
      `Failed to compile test robot config: ${compiled.errors.join("; ")}`
    );
  }

  return compiled.config;
}

export interface KineticEnergyBreakdown {
  readonly linearJ: number;
  readonly rotationalJ: number;
  readonly totalJ: number;
}

/**
 * Computes planar rigid-body kinetic energy directly from SimulationState and SimulationRobotConfig.
 */
export function computeRobotKineticEnergy(
  config: SimulationRobotConfig,
  state: SimulationState
): KineticEnergyBreakdown {
  const speedSq =
    state.longitudinalVelocityMps * state.longitudinalVelocityMps +
    state.lateralVelocityMps * state.lateralVelocityMps;
  const linearJ = 0.5 * config.totalMassKg * speedSq;
  const rotationalJ =
    0.5 * config.yawInertiaKgM2 * state.yawRateRadPerSec * state.yawRateRadPerSec;

  return {
    linearJ,
    rotationalJ,
    totalJ: linearJ + rotationalJ,
  };
}

/**
 * Verifies every numeric field on SimulationState is finite (no NaN or Infinity).
 */
export function assertFiniteSimulationState(state: SimulationState): void {
  const fields: readonly [string, number][] = [
    ["timeSeconds", state.timeSeconds],
    ["stepCount", state.stepCount],
    ["xMeters", state.xMeters],
    ["zMeters", state.zMeters],
    ["headingRadians", state.headingRadians],
    ["longitudinalVelocityMps", state.longitudinalVelocityMps],
    ["lateralVelocityMps", state.lateralVelocityMps],
    ["yawRateRadPerSec", state.yawRateRadPerSec],
    ["longitudinalAccelerationMps2", state.longitudinalAccelerationMps2],
    ["angularAccelerationRadPerSec2", state.angularAccelerationRadPerSec2],
    ["leftWheelAngularVelocityRadPerSec", state.leftWheelAngularVelocityRadPerSec],
    ["rightWheelAngularVelocityRadPerSec", state.rightWheelAngularVelocityRadPerSec],
    ["leftWheelLinearSurfaceSpeedMps", state.leftWheelLinearSurfaceSpeedMps],
    ["rightWheelLinearSurfaceSpeedMps", state.rightWheelLinearSurfaceSpeedMps],
    ["leftSlipRatio", state.leftSlipRatio],
    ["rightSlipRatio", state.rightSlipRatio],
    ["batteryTerminalVoltageV", state.batteryTerminalVoltageV],
    ["totalCurrentDrawA", state.totalCurrentDrawA],
    ["netDriveForceN", state.netDriveForceN],
    ["netYawTorqueNm", state.netYawTorqueNm],
  ];

  for (const [name, value] of fields) {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite SimulationState field "${name}": ${value}`);
    }
  }
  expect(state.headingRadians).toBeGreaterThan(-Math.PI - 1e-12);
  expect(state.headingRadians).toBeLessThanOrEqual(Math.PI + 1e-12);
}

export interface ScenarioPhase {
  readonly durationSeconds: number;
  readonly input: DrivetrainInput;
  readonly frameDurationSeconds?: number;
  readonly optionsOverride?: SimulationRunnerOptions;
}

export interface ScenarioRunSummary {
  readonly finalRunnerState: SimulationRunnerState;
  readonly finalState: SimulationState;
  readonly totalSteps: number;
  readonly collisionSteps: number;
  readonly maxPenetrationM: number;
  readonly maxLinearSpeedMps: number;
  readonly maxYawRateRadPerSec: number;
  readonly maxKineticEnergyJ: number;
  readonly finalKineticEnergyJ: number;
  readonly minBatteryVoltageV: number;
  readonly maxCurrentDrawA: number;
  readonly anyCutoff: boolean;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly advanceResults: readonly SimulationAdvanceResult[];
}

/**
 * Executes a multi-phase deterministic simulation scenario through advanceSimulation
 * and collects physical stability, boundary, battery, and energy metrics.
 */
export function runSimulationScenario(params: {
  readonly config: SimulationRobotConfig;
  readonly initialPose?: { x?: number; z?: number; heading?: number };
  readonly initialStateMutator?: (state: SimulationState) => SimulationState;
  readonly baseOptions?: SimulationRunnerOptions;
  readonly phases: readonly ScenarioPhase[];
}): ScenarioRunSummary {
  let runnerState = createInitialRunnerState(
    params.config,
    params.initialPose,
    params.baseOptions
  );

  if (params.initialStateMutator) {
    runnerState = {
      ...runnerState,
      simulationState: params.initialStateMutator(runnerState.simulationState),
    };
  }

  assertFiniteSimulationState(runnerState.simulationState);

  let collisionSteps = 0;
  let maxPenetrationM = 0;
  let maxLinearSpeedMps = 0;
  let maxYawRateRadPerSec = 0;
  let maxKineticEnergyJ = computeRobotKineticEnergy(
    params.config,
    runnerState.simulationState
  ).totalJ;
  let minBatteryVoltageV = runnerState.simulationState.batteryTerminalVoltageV;
  let maxCurrentDrawA = 0;
  let anyCutoff = runnerState.isCutoff;
  let minX = runnerState.simulationState.xMeters;
  let maxX = runnerState.simulationState.xMeters;
  let minZ = runnerState.simulationState.zMeters;
  let maxZ = runnerState.simulationState.zMeters;
  const advanceResults: SimulationAdvanceResult[] = [];

  for (const phase of params.phases) {
    const mergedOptions: SimulationRunnerOptions | undefined =
      phase.optionsOverride || params.baseOptions
        ? { ...params.baseOptions, ...phase.optionsOverride }
        : undefined;

    const frameDt = phase.frameDurationSeconds ?? phase.durationSeconds;
    const frameCount =
      frameDt > 0 ? Math.max(1, Math.round(phase.durationSeconds / frameDt)) : 1;

    let remaining = phase.durationSeconds;
    for (let i = 0; i < frameCount; i++) {
      const reqDt =
        i === frameCount - 1 ? Math.max(0, remaining) : Math.min(frameDt, remaining);
      remaining -= reqDt;

      const res = advanceSimulation(
        params.config,
        runnerState,
        phase.input,
        reqDt,
        mergedOptions
      );
      advanceResults.push(res);
      runnerState = res.runnerState;

      for (const step of res.stepDiagnostics) {
        const s = step.state;
        assertFiniteSimulationState(s);

        const speed = Math.hypot(s.longitudinalVelocityMps, s.lateralVelocityMps);
        maxLinearSpeedMps = Math.max(maxLinearSpeedMps, speed);
        maxYawRateRadPerSec = Math.max(maxYawRateRadPerSec, Math.abs(s.yawRateRadPerSec));

        const ke = computeRobotKineticEnergy(params.config, s).totalJ;
        maxKineticEnergyJ = Math.max(maxKineticEnergyJ, ke);

        minBatteryVoltageV = Math.min(minBatteryVoltageV, s.batteryTerminalVoltageV);
        maxCurrentDrawA = Math.max(maxCurrentDrawA, s.totalCurrentDrawA);
        if (s.isBatteryCutoff) {
          anyCutoff = true;
        }

        minX = Math.min(minX, s.xMeters);
        maxX = Math.max(maxX, s.xMeters);
        minZ = Math.min(minZ, s.zMeters);
        maxZ = Math.max(maxZ, s.zMeters);

        if (step.collisionResponse?.hasCollisions) {
          collisionSteps++;
          for (const c of step.collisionResponse.contacts) {
            maxPenetrationM = Math.max(maxPenetrationM, c.penetrationDepthM);
          }
        }
      }
    }
  }

  return {
    finalRunnerState: runnerState,
    finalState: runnerState.simulationState,
    totalSteps: runnerState.totalPhysicsSteps,
    collisionSteps,
    maxPenetrationM,
    maxLinearSpeedMps,
    maxYawRateRadPerSec,
    maxKineticEnergyJ,
    finalKineticEnergyJ: computeRobotKineticEnergy(
      params.config,
      runnerState.simulationState
    ).totalJ,
    minBatteryVoltageV,
    maxCurrentDrawA,
    anyCutoff,
    minX,
    maxX,
    minZ,
    maxZ,
    advanceResults,
  };
}
