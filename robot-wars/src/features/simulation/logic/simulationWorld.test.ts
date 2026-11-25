import { describe, expect, it, vi } from "vitest";
import { batteryCatalogue } from "../../robot-builder/data/batteryCatalogue";
import { foundationModels } from "../../robot-builder/data/foundationModels";
import { motorCatalogue } from "../../robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../../robot-builder/data/wheelCatalogue";
import { generateMotorMountZones } from "../../robot-builder/logic/mountingZones";
import type {
  DrivetrainConfiguration,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../../robot-builder/types/robot.types";
import {
  createRectangularArena,
  STANDARD_ROBOT_WARS_ARENA,
} from "./arenaModel";
import { DEFAULT_FIXED_TIMESTEP_SECONDS } from "./simulationRunner";
import { buildCompiledCatalogueRobot } from "./simulationScenarioTestHelpers";
import {
  mapDriveControlsToDrivetrainInput,
  NEUTRAL_DRIVE_CONTROLS,
  OBSTACLE_TEST_ARENA,
  SIMULATION_ARENA_PRESETS,
  SimulationWorld,
} from "./simulationWorld";

function createValidAssemblyData(): {
  parts: RobotPart[];
  connections: RobotConnection[];
  drivetrain: DrivetrainConfiguration;
  foundation: FoundationConfig;
} {
  const foundationDef = foundationModels[0];
  const motorDef = motorCatalogue[1];
  const wheelDef = wheelCatalogue[0];
  const batteryDef = batteryCatalogue[1];

  const foundation: FoundationConfig = {
    modelId: foundationDef.id,
    length: foundationDef.length,
    width: foundationDef.width,
    height: foundationDef.height,
    includeTopPlate: false,
    includeFrontCover: false,
    confirmed: true,
  };

  const zones = generateMotorMountZones(foundation);
  const flZone = zones.find((z) => z.id === "front-left")!;
  const frZone = zones.find((z) => z.id === "front-right")!;
  const rlZone = zones.find((z) => z.id === "rear-left")!;
  const rrZone = zones.find((z) => z.id === "rear-right")!;

  const halfTrack = foundation.width / 2;
  const wheelZ = halfTrack + wheelDef.width / 2;

  const parts: RobotPart[] = [
    {
      id: "foundation-chassis",
      name: foundationDef.name,
      type: "Structural Block",
      foundationModelId: foundationDef.id,
      position: [0, 0.25, 0],
      rotation: [0, 0, 0],
      size: [foundation.length, foundation.height, foundation.width],
      color: "#334155",
      mass: 4.0,
      massKg: 4.0,
      geometry: { ...foundationDef.geometry },
    },
    {
      id: "battery-1",
      name: batteryDef.name,
      type: "Battery",
      batteryCatalogueId: batteryDef.id,
      position: [0, 0.4, 0],
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

  const connections: RobotConnection[] = [];
  const slots = [
    { id: "fl", zone: flZone, zSign: 1 },
    { id: "rl", zone: rlZone, zSign: 1 },
    { id: "fr", zone: frZone, zSign: -1 },
    { id: "rr", zone: rrZone, zSign: -1 },
  ];

  for (const s of slots) {
    const motorId = `motor-${s.id}`;
    const wheelId = `wheel-${s.id}`;
    const mechId = `conn-${motorId}`;
    const mwId = `conn-${motorId}-${wheelId}`;

    parts.push(
      {
        id: motorId,
        name: `${motorDef.name} ${s.id}`,
        type: "Motor",
        motorCatalogueId: motorDef.id,
        mountingZoneId: s.zone.id,
        parentAttachmentId: mechId,
        position: [s.zone.position[0], 0.11, s.zSign * (halfTrack - 0.2)],
        rotation: [...s.zone.rotation],
        size: [...motorDef.dimensions],
        color: motorDef.color,
        mass: motorDef.massKg,
        massKg: motorDef.massKg,
        geometry: { ...motorDef.geometry },
        mechanical: { ...motorDef.mechanical },
        engineeringSpec: motorDef.engineeringSpec,
      },
      {
        id: wheelId,
        name: `${wheelDef.name} ${s.id}`,
        type: "Wheel",
        wheelCatalogueId: wheelDef.id,
        parentAttachmentId: mwId,
        position: [s.zone.position[0], 0.11, s.zSign * wheelZ],
        rotation: [0, 0, 0],
        size: [wheelDef.diameter, wheelDef.width, wheelDef.diameter],
        color: wheelDef.color,
        mass: wheelDef.massKg,
        massKg: wheelDef.massKg,
        geometry: { ...wheelDef.geometry },
        engineeringSpec: wheelDef.engineeringSpec,
      }
    );

    connections.push(
      {
        id: mechId,
        type: "Mechanical",
        sourceId: "foundation-chassis",
        targetId: motorId,
        parentId: "foundation-chassis",
        childId: motorId,
        parentMountPointId: s.zone.id,
        childMountPointId: "housing",
        relativePosition: [0, 0, 0],
        relativeRotation: [0, 0, 0],
      },
      {
        id: mwId,
        type: "Motor-Wheel",
        sourceId: motorId,
        targetId: wheelId,
        parentId: motorId,
        childId: wheelId,
        parentMountPointId: "motor-shaft",
        childMountPointId: "wheel-hub",
        relativePosition: [0, 0, 0],
        relativeRotation: [0, 0, 0],
      }
    );
  }

  const drivetrain: DrivetrainConfiguration = {
    type: "differential-4",
    left: [
      { motorId: "motor-fl", wheelId: "wheel-fl" },
      { motorId: "motor-rl", wheelId: "wheel-rl" },
    ],
    right: [
      { motorId: "motor-fr", wheelId: "wheel-fr" },
      { motorId: "motor-rr", wheelId: "wheel-rr" },
    ],
    mappingCustomized: false,
  };

  return { parts, connections, drivetrain, foundation };
}

describe("Phase 4.2: SimulationWorld Orchestration", () => {
  describe("1. Initialization & Assembly Compilation Integration", () => {
    it("compiles a valid robot assembly once and initializes a ready SimulationWorld", () => {
      const assembly = createValidAssemblyData();
      const init = SimulationWorld.fromAssembly({
        ...assembly,
        arena: STANDARD_ROBOT_WARS_ARENA,
      });

      expect(init.success).toBe(true);
      expect(init.errors).toHaveLength(0);
      expect(init.world).not.toBeNull();

      const world = init.world!;
      expect(world.getLifecycleStatus()).toBe("ready");
      expect(world.getArena().id).toBe(STANDARD_ROBOT_WARS_ARENA.id);
      expect(world.getRobotConfig().drivetrain.type).toBe("differential-4");
      expect(world.getRunnerState().totalPhysicsSteps).toBe(0);
      expect(world.getCollisionIndicator().hasCollision).toBe(false);
    });

    it("provides valid built-in arena presets including obstacle and open arenas", () => {
      expect(SIMULATION_ARENA_PRESETS.length).toBeGreaterThanOrEqual(2);
      expect(SIMULATION_ARENA_PRESETS.some((p) => p.arena.id === OBSTACLE_TEST_ARENA.id)).toBe(true);
      expect(SIMULATION_ARENA_PRESETS.some((p) => p.arena.id === STANDARD_ROBOT_WARS_ARENA.id)).toBe(true);
    });

    it("fails deterministically on invalid robot assembly or invalid arena", () => {
      const badInit = SimulationWorld.fromAssembly({
        parts: [],
        connections: [],
        drivetrain: null,
      });

      expect(badInit.success).toBe(false);
      expect(badInit.world).toBeNull();
      expect(badInit.errors.length).toBeGreaterThan(0);

      const validRobot = buildCompiledCatalogueRobot();
      expect(() => {
        new SimulationWorld({
          robotConfig: { ...validRobot, totalMassKg: 0 },
          arena: STANDARD_ROBOT_WARS_ARENA,
        });
      }).toThrow(/Invalid robot configuration/);

      expect(() => {
        new SimulationWorld({
          robotConfig: validRobot,
          arena: { ...STANDARD_ROBOT_WARS_ARENA, id: "" },
        });
      }).toThrow(/Invalid arena configuration/);
    });
  });

  describe("2. Input Mapping & Clearing", () => {
    it("maps forward, reverse, left, right, and combined directional controls to differential throttles", () => {
      expect(mapDriveControlsToDrivetrainInput(NEUTRAL_DRIVE_CONTROLS)).toEqual({
        leftThrottle: 0,
        rightThrottle: 0,
      });

      expect(
        mapDriveControlsToDrivetrainInput({ ...NEUTRAL_DRIVE_CONTROLS, forward: true })
      ).toEqual({ leftThrottle: 1, rightThrottle: 1 });

      expect(
        mapDriveControlsToDrivetrainInput({ ...NEUTRAL_DRIVE_CONTROLS, reverse: true })
      ).toEqual({ leftThrottle: -1, rightThrottle: -1 });

      // Left turn (+Z CCW) requires rightThrottle > leftThrottle
      expect(
        mapDriveControlsToDrivetrainInput({ ...NEUTRAL_DRIVE_CONTROLS, left: true })
      ).toEqual({ leftThrottle: -1, rightThrottle: 1 });

      // Right turn (-Z CW) requires leftThrottle > rightThrottle
      expect(
        mapDriveControlsToDrivetrainInput({ ...NEUTRAL_DRIVE_CONTROLS, right: true })
      ).toEqual({ leftThrottle: 1, rightThrottle: -1 });

      // Forward + Left turns smoothly forward-left
      expect(
        mapDriveControlsToDrivetrainInput({
          forward: true,
          reverse: false,
          left: true,
          right: false,
        })
      ).toEqual({ leftThrottle: 0, rightThrottle: 1 });
    });

    it("clears inputs on pause, reset, focus-loss simulation, and dispose", () => {
      const world = new SimulationWorld({
        robotConfig: buildCompiledCatalogueRobot(),
        arena: STANDARD_ROBOT_WARS_ARENA,
      });

      world.start();
      world.setDriveControls({ forward: true, left: true });
      expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 1 });

      // Pause clears controls
      world.pause();
      expect(world.getActiveControls()).toEqual(NEUTRAL_DRIVE_CONTROLS);
      expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

      // Resume and drive again
      world.resume();
      world.setDriveControls({ forward: true });
      world.stepFrame(0.05);
      expect(world.getRunnerState().simulationState.xMeters).toBeGreaterThan(0);

      // Simulate focus-loss clearInputs
      world.clearInputs();
      expect(world.getActiveControls()).toEqual(NEUTRAL_DRIVE_CONTROLS);

      // Reset clears controls and state
      world.setDriveControls({ reverse: true });
      world.reset();
      expect(world.getActiveControls()).toEqual(NEUTRAL_DRIVE_CONTROLS);
      expect(world.getLifecycleStatus()).toBe("ready");

      // Dispose clears controls and detaches listeners
      const listener = vi.fn();
      world.subscribe(listener);
      world.start();
      world.setDriveControls({ forward: true });
      world.dispose();
      expect(world.getActiveControls()).toEqual(NEUTRAL_DRIVE_CONTROLS);
      expect(world.getLifecycleStatus()).toBe("paused");
    });
  });

  describe("3. Lifecycle, Fixed-Timestep Integration & Deterministic Reset", () => {
    it("advances physics only while running and maintains fixed timestep accumulator", () => {
      const world = new SimulationWorld({
        robotConfig: buildCompiledCatalogueRobot(),
        arena: STANDARD_ROBOT_WARS_ARENA,
      });

      // Ready state: stepFrame does not advance physics
      world.setDriveControls({ forward: true });
      expect(world.stepFrame(0.05)).toBeNull();
      expect(world.getRunnerState().totalPhysicsSteps).toBe(0);

      // Running state: 0.01 s frame executes 1 fixed step (1/120 s) + preserves remainder
      world.start();
      const adv1 = world.stepFrame(0.01);
      expect(adv1).not.toBeNull();
      expect(adv1!.fixedTimestepSeconds).toBe(DEFAULT_FIXED_TIMESTEP_SECONDS);
      expect(adv1!.stepsExecuted).toBe(1);
      expect(world.getRunnerState().accumulatorSeconds).toBeCloseTo(0.01 - 1 / 120, 6);

      // Paused state: stepFrame is ignored
      world.pause();
      const stepsBeforePause = world.getRunnerState().totalPhysicsSteps;
      expect(world.stepFrame(0.1)).toBeNull();
      expect(world.getRunnerState().totalPhysicsSteps).toBe(stepsBeforePause);

      // Resume continues from exact preserved state
      world.resume();
      world.setDriveControls({ forward: true });
      world.stepFrame(0.05);
      expect(world.getRunnerState().totalPhysicsSteps).toBeGreaterThan(stepsBeforePause);
    });

    it("restores deterministic initial state on reset and reproduces identical trajectories", () => {
      const world = new SimulationWorld({
        robotConfig: buildCompiledCatalogueRobot(),
        arena: OBSTACLE_TEST_ARENA,
      });

      const runTrajectory = () => {
        world.start();
        world.setDriveControls({ forward: true, left: true });
        for (let i = 0; i < 20; i++) {
          world.stepFrame(0.02);
        }
        return world.getRunnerState();
      };

      const run1 = runTrajectory();
      expect(run1.totalPhysicsSteps).toBe(48);
      expect(run1.simulationState.xMeters).toBeGreaterThan(0);

      world.reset();
      expect(world.getLifecycleStatus()).toBe("ready");
      expect(world.getRunnerState().totalPhysicsSteps).toBe(0);
      expect(world.getRunnerState().accumulatorSeconds).toBe(0);
      expect(world.getRunnerState().simulationState.xMeters).toBe(0);
      expect(world.getRunnerState().simulationState.zMeters).toBe(0);
      expect(world.getRunnerState().simulationState.headingRadians).toBe(0);
      expect(world.getRunnerState().simulationState.longitudinalVelocityMps).toBe(0);
      expect(world.getRunnerState().simulationState.lateralVelocityMps).toBe(0);
      expect(world.getRunnerState().simulationState.yawRateRadPerSec).toBe(0);

      const run2 = runTrajectory();
      expect(run2).toEqual(run1);
    });
  });

  describe("4. Telemetry & Collision Diagnostics Integration", () => {
    it("maps real drivetrain, battery, and collision diagnostics into telemetry and render pose", () => {
      const compactArena = createRectangularArena({
        id: "world-collision-test",
        name: "World Collision Arena",
        lengthM: 4.0,
        widthM: 4.0,
        wallThicknessM: 0.2,
      });
      const world = new SimulationWorld({
        robotConfig: buildCompiledCatalogueRobot(),
        arena: compactArena,
      });

      world.start();
      world.setDriveControls({ forward: true });

      let sawCollision = false;
      for (let i = 0; i < 40; i++) {
        world.stepFrame(0.05);
        const telemetry = world.getTelemetrySnapshot();
        if (telemetry.collision.hasCollision) {
          sawCollision = true;
          expect(telemetry.collision.contactCount).toBeGreaterThanOrEqual(1);
          expect(telemetry.collision.collidedBarrierIds).toContain(
            "perimeter-wall-north-x-pos"
          );
          break;
        }
      }

      expect(sawCollision).toBe(true);

      const telemetry = world.getTelemetrySnapshot();
      const pose = world.getRenderPose();
      expect(pose.xMeters).toBe(telemetry.xMeters);
      expect(pose.zMeters).toBe(telemetry.zMeters);
      expect(pose.headingRadians).toBe(telemetry.headingRadians);
      expect(pose.hasCollision).toBe(telemetry.collision.hasCollision);
      expect(telemetry.batteryTerminalVoltageV).toBeGreaterThan(0);
      expect(telemetry.totalCurrentDrawA).toBeGreaterThan(0);
      expect(telemetry.xMeters).toBeLessThan(2.0);
    });

    it("switches arena presets cleanly and performs a deterministic reset", () => {
      const world = new SimulationWorld({
        robotConfig: buildCompiledCatalogueRobot(),
        arena: STANDARD_ROBOT_WARS_ARENA,
      });

      world.start();
      world.setDriveControls({ forward: true });
      world.stepFrame(0.1);
      expect(world.getRunnerState().totalPhysicsSteps).toBeGreaterThan(0);

      world.setArena(OBSTACLE_TEST_ARENA);
      expect(world.getArena().id).toBe(OBSTACLE_TEST_ARENA.id);
      expect(world.getLifecycleStatus()).toBe("ready");
      expect(world.getRunnerState().totalPhysicsSteps).toBe(0);
      expect(world.getRunnerState().simulationState.xMeters).toBe(0);
    });
  });
});
