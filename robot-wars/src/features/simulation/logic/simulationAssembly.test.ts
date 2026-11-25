import { describe, expect, it } from "vitest";
import { batteryCatalogue } from "../../robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../../robot-builder/data/controllerCatalogue";
import { foundationModels } from "../../robot-builder/data/foundationModels";
import { motorCatalogue } from "../../robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../../robot-builder/data/wheelCatalogue";
import { generateMotorMountZones } from "../../robot-builder/logic/mountingZones";
import { getMotorShaftMountPosition } from "../../robot-builder/logic/mounting";
import { getWheelWorldMountTransform } from "../../robot-builder/logic/wheelMounting";
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
import {
  createRobotCollisionEnvelope,
  detectArenaCollisions,
} from "./collisionModel";
import {
  buildAssemblyInspectionSummary,
  computeAssemblyFootprintDimensions,
  computeWheelAxleSpinSign,
  resolveAssemblySimulationVisualSpec,
  resolveCollisionVisualState,
  resolveCompiledRobotFootprint,
  resolveSafeSimulationSpawnPose,
} from "./simulationAssembly";
import { buildCompiledCatalogueRobot } from "./simulationScenarioTestHelpers";
import {
  SIMULATION_ARENA_PRESETS,
  SimulationWorld,
} from "./simulationWorld";

function buildWorkshopAssemblyFixture(mode: "2wd" | "4wd", includeFrontCover = true) {
  const foundationDef = foundationModels[1]; // standard-rectangular: 2.0 x 1.6 x 0.35
  const motorDef = motorCatalogue[1];
  const wheelDef = wheelCatalogue[0];
  const batteryDef = batteryCatalogue[1];
  const controllerDef = controllerCatalogue[1];

  const foundation: FoundationConfig = {
    modelId: foundationDef.id,
    length: foundationDef.length,
    width: foundationDef.width,
    height: foundationDef.height,
    includeTopPlate: true,
    includeFrontCover,
    confirmed: true,
  };

  const zones = generateMotorMountZones(foundation);
  const selectedZoneIds =
    mode === "2wd"
      ? (["front-left", "front-right"] as const)
      : (["front-left", "rear-left", "front-right", "rear-right"] as const);

  const parts: RobotPart[] = [
    {
      id: "foundation-chassis",
      name: "Standard Rectangular Chassis",
      type: "Structural Block",
      foundationModelId: foundation.modelId,
      position: [0, foundation.height * 0.5, 0],
      rotation: [0, 0, 0],
      size: [foundation.length, foundation.height, foundation.width],
      color: "#334155",
      mass: 6.0,
      massKg: 6.0,
      geometry: {
        shape: "box",
        length: foundation.length,
        height: foundation.height,
        width: foundation.width,
      },
    },
    {
      id: "foundation-top-plate",
      name: "Top Cover Plate",
      type: "Armor Plate",
      position: [0, foundation.height + 0.09, 0],
      rotation: [0, 0, 0],
      size: [foundation.length * 0.88, 0.05, foundation.width * 0.86],
      color: "#64748b",
      mass: 1.0,
      massKg: 1.0,
      geometry: {
        shape: "box",
        length: foundation.length * 0.88,
        height: 0.05,
        width: foundation.width * 0.86,
      },
    },
    {
      id: "battery-1",
      name: batteryDef.name,
      type: "Battery",
      batteryCatalogueId: batteryDef.id,
      position: [-0.2, foundation.height * 0.5 + 0.1, 0],
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
    {
      id: "controller-1",
      name: controllerDef.name,
      type: "Controller",
      controllerCatalogueId: controllerDef.id,
      position: [0.2, foundation.height + 0.04, 0],
      rotation: [0, 0, 0],
      size: [
        controllerDef.dimensions.length,
        controllerDef.dimensions.height,
        controllerDef.dimensions.width,
      ],
      color: controllerDef.color,
      mass: controllerDef.massKg,
      massKg: controllerDef.massKg,
      geometry: { ...controllerDef.geometry },
      electrical: { ...controllerDef.electrical },
      engineeringSpec: controllerDef.engineeringSpec,
    },
  ];

  if (includeFrontCover) {
    parts.push({
      id: "foundation-front-cover",
      name: "Front Bumper Assembly",
      type: "Front Bumper",
      position: [foundation.length * 0.5 + 0.06, foundation.height * 0.5, 0],
      rotation: [0, 0, 0],
      size: [0.12, foundation.height * 0.72, foundation.width * 0.92],
      color: "#f59e0b",
      mass: 0.8,
      massKg: 0.8,
      geometry: {
        shape: "box",
        length: 0.12,
        height: foundation.height * 0.72,
        width: foundation.width * 0.92,
      },
    });
  }

  const connections: RobotConnection[] = [];
  const left: DrivetrainConfiguration["left"] = [];
  const right: DrivetrainConfiguration["right"] = [];

  for (const zoneId of selectedZoneIds) {
    const zone = zones.find((z) => z.id === zoneId)!;
    const motorId = `motor-${zoneId}`;
    const wheelId = `wheel-${zoneId}`;

    const motorPart: RobotPart = {
      id: motorId,
      name: motorDef.name,
      type: "Motor",
      motorCatalogueId: motorDef.id,
      mountingZoneId: zone.id,
      parentAttachmentId: `mech-${motorId}`,
      position: [...zone.position],
      rotation: [...zone.rotation],
      size: [...motorDef.dimensions],
      color: motorDef.color,
      mass: motorDef.massKg,
      massKg: motorDef.massKg,
      geometry: { ...motorDef.geometry },
      mechanical: { ...motorDef.mechanical },
      engineeringSpec: motorDef.engineeringSpec,
    };

    const wheelTransform = getWheelWorldMountTransform(motorPart, wheelDef);
    const wheelPart: RobotPart = {
      id: wheelId,
      name: wheelDef.name,
      type: "Wheel",
      wheelCatalogueId: wheelDef.id,
      wheelDiameter: wheelDef.diameter,
      wheelWidth: wheelDef.width,
      parentAttachmentId: `mw-${motorId}`,
      position: [...wheelTransform.position],
      rotation: [...wheelTransform.rotation],
      size: [wheelDef.diameter, wheelDef.width, wheelDef.diameter],
      color: wheelDef.color,
      mass: wheelDef.massKg,
      massKg: wheelDef.massKg,
      geometry: { ...wheelDef.geometry },
      engineeringSpec: wheelDef.engineeringSpec,
    };

    parts.push(motorPart, wheelPart);
    connections.push(
      {
        id: `mech-${motorId}`,
        type: "Mechanical",
        sourceId: "foundation-chassis",
        targetId: motorId,
        parentId: "foundation-chassis",
        childId: motorId,
        parentMountPointId: zone.id,
        childMountPointId: "housing",
        relativePosition: [0, 0, 0],
        relativeRotation: [0, 0, 0],
      },
      {
        id: `mw-${motorId}`,
        type: "Motor-Wheel",
        sourceId: motorId,
        targetId: wheelId,
        parentId: motorId,
        childId: wheelId,
        parentMountPointId: "motor-shaft",
        childMountPointId: "wheel-hub",
        relativePosition: [
          ...getMotorShaftMountPosition(motorPart),
        ],
        relativeRotation: [0, 0, 0],
      }
    );

    if (zone.id.endsWith("-left")) {
      left.push({ motorId, wheelId });
    } else {
      right.push({ motorId, wheelId });
    }
  }

  const drivetrain: DrivetrainConfiguration = {
    type: mode === "2wd" ? "differential-2" : "differential-4",
    left,
    right,
    mappingCustomized: false,
  };

  return { parts, connections, drivetrain, foundation };
}

describe("Phase 4.5: Assembly Visualization Fidelity & Spawn Validation", () => {
  describe("1. Assembly-to-Visual Mapping", () => {
    it("maps installed 2WD assembly parts cleanly without inventing extra components", () => {
      const fixture = buildWorkshopAssemblyFixture("2wd", true);
      const spec = resolveAssemblySimulationVisualSpec({
        parts: fixture.parts,
        connections: fixture.connections,
        drivetrain: fixture.drivetrain,
      });

      expect(spec.hasChassis).toBe(true);
      expect(spec.motorCount).toBe(2);
      expect(spec.wheelCount).toBe(2);
      expect(spec.leftWheelPartIds).toEqual(["wheel-front-left"]);
      expect(spec.rightWheelPartIds).toEqual(["wheel-front-right"]);
      expect(spec.parts).toHaveLength(fixture.parts.length);

      const frontLeftWheel = spec.parts.find(
        (p) => p.partId === "wheel-front-left"
      )!;
      const frontRightWheel = spec.parts.find(
        (p) => p.partId === "wheel-front-right"
      )!;
      expect(frontLeftWheel.kind).toBe("wheel");
      expect(frontLeftWheel.drivetrainSide).toBe("left");
      expect(frontLeftWheel.cylinderDimensions.radius).toBeCloseTo(0.11, 6);
      expect(frontLeftWheel.cylinderDimensions.width).toBeCloseTo(0.07, 6);
      expect(frontLeftWheel.axleSpinSign).toBe(-1);
      expect(frontLeftWheel.position[2]).toBeGreaterThan(0);

      expect(frontRightWheel.drivetrainSide).toBe("right");
      expect(frontRightWheel.axleSpinSign).toBe(1);
      expect(frontRightWheel.position[2]).toBeLessThan(0);

      const battery = spec.parts.find((p) => p.kind === "battery")!;
      expect(battery.batteryMeta?.design).toBe("hardcase-3s");
      expect(battery.batteryMeta?.voltage).toBe(11.1);

      const controller = spec.parts.find((p) => p.kind === "controller")!;
      expect(controller.controllerMeta?.variant).toBe("esp32");

      const bumper = spec.parts.find((p) => p.kind === "bumper")!;
      expect(bumper.boxExtents[0]).toBeCloseTo(0.12, 6);
    });

    it("maps 4WD builds with all 4 motors and wheels aligned to Workshop coordinates", () => {
      const fixture = buildWorkshopAssemblyFixture("4wd", false);
      const spec = resolveAssemblySimulationVisualSpec({
        parts: fixture.parts,
        connections: fixture.connections,
        drivetrain: fixture.drivetrain,
      });

      expect(spec.motorCount).toBe(4);
      expect(spec.wheelCount).toBe(4);
      expect(spec.leftWheelPartIds).toEqual([
        "wheel-front-left",
        "wheel-rear-left",
      ]);
      expect(spec.rightWheelPartIds).toEqual([
        "wheel-front-right",
        "wheel-rear-right",
      ]);
      expect(spec.parts.some((p) => p.kind === "bumper")).toBe(false);
    });

    it("computes vertical grounding offset so lowest part bottom sits flush on y = 0", () => {
      const fixture = buildWorkshopAssemblyFixture("2wd", false);
      // Case A: standard chassis bottom is at y = 0 -> zero vertical shift
      const grounded = resolveAssemblySimulationVisualSpec({
        parts: fixture.parts,
        connections: fixture.connections,
        drivetrain: fixture.drivetrain,
      });
      expect(grounded.verticalOffsetY).toBe(0);

      // Case B: oversized wheel dipping below y = 0 lifts entire assembly cleanly
      const shiftedParts = fixture.parts.map((part) =>
        part.id === "wheel-front-left"
          ? {
              ...part,
              position: [part.position[0], 0.05, part.position[2]] as [
                number,
                number,
                number,
              ],
            }
          : part
      );
      const lifted = resolveAssemblySimulationVisualSpec({
        parts: shiftedParts,
        connections: fixture.connections,
        drivetrain: fixture.drivetrain,
      });
      // bottom = 0.05 - 0.11 = -0.06 -> verticalOffsetY = +0.06
      expect(lifted.verticalOffsetY).toBeCloseTo(0.06, 6);
    });

    it("flips axle spin sign accurately if a motor is rotated 180 degrees", () => {
      expect(computeWheelAxleSpinSign([0, -Math.PI / 2, 0])).toBe(-1);
      expect(computeWheelAxleSpinSign([0, Math.PI / 2, 0])).toBe(1);
      expect(computeWheelAxleSpinSign([0, Math.PI / 2 + Math.PI, 0])).toBe(-1);
    });
  });

  describe("2. Assembly Footprint & OBB Consistency", () => {
    it("derives assembly footprint enclosing full chassis, bumper, and mounted wheels", () => {
      const fixture = buildWorkshopAssemblyFixture("4wd", true);
      const compiled = SimulationWorld.fromAssembly({
        ...fixture,
        arena: STANDARD_ROBOT_WARS_ARENA,
      });
      expect(compiled.success).toBe(true);
      const world = compiled.world!;
      const robotFootprint = world.getRobotFootprint();
      const assemblyBounds = computeAssemblyFootprintDimensions(fixture.parts);
      const resolved = resolveCompiledRobotFootprint(
        world.getRobotConfig(),
        fixture.parts
      );

      // Front bumper reaches x = 1.0 + 0.06 + 0.06 = 1.12 -> symmetric length = 2.24m
      expect(assemblyBounds.lengthM).toBeCloseTo(2.24, 5);
      expect(robotFootprint.lengthM).toBeGreaterThanOrEqual(
        assemblyBounds.lengthM - 1e-6
      );
      expect(robotFootprint.widthM).toBeGreaterThanOrEqual(
        assemblyBounds.widthM - 1e-6
      );
      expect(robotFootprint).toEqual(resolved);
    });
  });

  describe("3. Safe Deterministic Spawn Placement & Validation", () => {
    it("spawns at (0, 0) in open arenas and across all built-in arena presets without collision", () => {
      const fixture = buildWorkshopAssemblyFixture("4wd", true);
      for (const preset of SIMULATION_ARENA_PRESETS) {
        const init = SimulationWorld.fromAssembly({
          ...fixture,
          arena: preset.arena,
        });
        expect(init.success).toBe(true);
        const world = init.world!;
        const pose = world.getRenderPose();
        const envelope = createRobotCollisionEnvelope(
          {
            x: pose.xMeters,
            z: pose.zMeters,
            headingRadians: pose.headingRadians,
          },
          world.getRobotFootprint()
        );
        const collision = detectArenaCollisions(envelope, preset.arena);
        expect(collision.hasCollision).toBe(false);
        expect(pose.xMeters).toBeGreaterThan(preset.arena.bounds.minX);
        expect(pose.xMeters).toBeLessThan(preset.arena.bounds.maxX);
        expect(pose.zMeters).toBeGreaterThan(preset.arena.bounds.minZ);
        expect(pose.zMeters).toBeLessThan(preset.arena.bounds.maxZ);
      }
    });

    it("shifts spawn to nearest collision-free interior pose when center is blocked by a barrier", () => {
      const centerBlockedArena = createRectangularArena({
        id: "center-obstacle-arena",
        name: "Center Pylon Arena",
        lengthM: 10,
        widthM: 10,
        wallThicknessM: 0.4,
        barriers: [
          {
            id: "center-pylon",
            name: "Center Pylon",
            geometryType: "rectangle",
            position: { x: 0, z: 0 },
            sizeX: 1.6,
            sizeZ: 1.6,
            heightM: 0.4,
            rotationRadians: 0,
          },
        ],
      });

      const fixture = buildWorkshopAssemblyFixture("2wd", true);
      const init1 = SimulationWorld.fromAssembly({
        ...fixture,
        arena: centerBlockedArena,
      });
      const init2 = SimulationWorld.fromAssembly({
        ...fixture,
        arena: centerBlockedArena,
      });

      expect(init1.success).toBe(true);
      const pose1 = init1.world!.getRenderPose();
      const pose2 = init2.world!.getRenderPose();
      expect(pose1).toEqual(pose2);
      expect(Math.hypot(pose1.xMeters, pose1.zMeters)).toBeGreaterThan(0.5);

      const envelope = createRobotCollisionEnvelope(
        {
          x: pose1.xMeters,
          z: pose1.zMeters,
          headingRadians: pose1.headingRadians,
        },
        init1.world!.getRobotFootprint()
      );
      expect(detectArenaCollisions(envelope, centerBlockedArena).hasCollision).toBe(
        false
      );

      // Driving and resetting must return deterministically to the validated spawn pose
      init1.world!.start();
      init1.world!.setDriveControls({ forward: true });
      init1.world!.stepFrame(0.08);
      init1.world!.reset();
      expect(init1.world!.getRenderPose().xMeters).toBe(pose1.xMeters);
      expect(init1.world!.getRenderPose().zMeters).toBe(pose1.zMeters);
    });

    it("centers spawn inside non-origin-centered arenas instead of defaulting blindly to (0, 0)", () => {
      const offsetArena = createRectangularArena({
        id: "offset-arena",
        name: "Offset Arena",
        lengthM: 8,
        widthM: 8,
        center: { x: 10, z: -6 },
      });

      const world = new SimulationWorld({
        robotConfig: buildCompiledCatalogueRobot(),
        arena: offsetArena,
      });

      const pose = world.getRenderPose();
      expect(pose.xMeters).toBeCloseTo(10, 5);
      expect(pose.zMeters).toBeCloseTo(-6, 5);
    });

    it("relocates an explicit colliding initialPose to nearest valid interior spot and rejects unspawnable arenas", () => {
      const robotConfig = buildCompiledCatalogueRobot();
      const wallCollidingResolution = resolveSafeSimulationSpawnPose(
        STANDARD_ROBOT_WARS_ARENA,
        { lengthM: 1.5, widthM: 1.2 },
        { x: 5.95, z: 0, heading: 0 }
      );
      expect(wallCollidingResolution.valid).toBe(true);
      if (wallCollidingResolution.valid) {
        expect(wallCollidingResolution.adjustedFromPreferred).toBe(true);
        expect(wallCollidingResolution.pose.x).toBeLessThan(5.95);
      }

      const tinyArena = createRectangularArena({
        id: "tiny-unspawnable",
        name: "Tiny Arena",
        lengthM: 1.0,
        widthM: 1.0,
        wallThicknessM: 0.2,
      });

      const fixture = buildWorkshopAssemblyFixture("4wd", true);
      const badInit = SimulationWorld.fromAssembly({
        ...fixture,
        arena: tinyArena,
      });
      expect(badInit.success).toBe(false);
      expect(badInit.world).toBeNull();
      expect(badInit.errors.some((e) => e.includes("No valid collision-free spawn"))).toBe(
        true
      );
      expect(() => {
        new SimulationWorld({
          robotConfig,
          arena: tinyArena,
          runnerOptions: { robotFootprint: { lengthM: 1.8, widthM: 1.6 } },
        });
      }).toThrow(/No valid collision-free spawn/);
    });
  });

  describe("4. Collision Visual State Separation & Reset Behavior", () => {
    it("separates neutral idle footprint outline from active collision highlight and clears on reset", () => {
      const idleVisual = resolveCollisionVisualState(false);
      expect(idleVisual.showFootprintOutline).toBe(true);
      expect(idleVisual.showCollisionHighlight).toBe(false);
      expect(idleVisual.footprintOutlineColor).not.toBe("#ef4444");

      const collidingVisual = resolveCollisionVisualState(true);
      expect(collidingVisual.showFootprintOutline).toBe(true);
      expect(collidingVisual.showCollisionHighlight).toBe(true);
      expect(collidingVisual.collisionHighlightColor).toBe("#ef4444");
      expect(collidingVisual.inspectionHighlightColor).not.toBe(
        collidingVisual.collisionHighlightColor
      );

      // Verify idle initialization & collision clearing after impact + reset
      const compactArena = createRectangularArena({
        id: "reset-visual-arena",
        name: "Reset Visual Arena",
        lengthM: 4.0,
        widthM: 4.0,
        wallThicknessM: 0.2,
      });
      const fixture = buildWorkshopAssemblyFixture("2wd", false);
      const init = SimulationWorld.fromAssembly({
        ...fixture,
        arena: compactArena,
      });
      expect(init.success).toBe(true);
      const world = init.world!;

      expect(world.getCollisionIndicator().hasCollision).toBe(false);
      expect(world.getRenderPose().hasCollision).toBe(false);

      world.start();
      world.setDriveControls({ forward: true });
      let collided = false;
      for (let i = 0; i < 40; i++) {
        world.stepFrame(0.05);
        if (world.getCollisionIndicator().hasCollision) {
          collided = true;
          break;
        }
      }
      expect(collided).toBe(true);
      expect(world.getTelemetrySnapshot().collision.hasCollision).toBe(true);

      world.reset();
      expect(world.getLifecycleStatus()).toBe("ready");
      expect(world.getCollisionIndicator().hasCollision).toBe(false);
      expect(world.getCollisionIndicator().collidedBarrierIds).toEqual([]);
      expect(world.getTelemetrySnapshot().collision.hasCollision).toBe(false);
      expect(world.getRenderPose().hasCollision).toBe(false);
    });
  });

  describe("5. Assembly Inspection Summary & Workshop Alignment", () => {
    it("summarizes installed components cleanly without fabricating absent parts", () => {
      const fixture = buildWorkshopAssemblyFixture("2wd", false);
      const compiled = SimulationWorld.fromAssembly({
        ...fixture,
        arena: STANDARD_ROBOT_WARS_ARENA,
      });
      expect(compiled.success).toBe(true);
      const world = compiled.world!;

      const summary = buildAssemblyInspectionSummary({
        parts: fixture.parts,
        connections: fixture.connections,
        drivetrain: fixture.drivetrain,
        foundation: fixture.foundation,
        robotConfig: world.getRobotConfig(),
        footprint: world.getRobotFootprint(),
      });

      expect(summary.componentCount).toBe(fixture.parts.length);
      expect(summary.drivetrainType).toBe("differential-2");
      expect(summary.motorCount).toBe(2);
      expect(summary.wheelCount).toBe(2);
      expect(summary.batteryName).toContain("LiPo");
      expect(summary.controllerName).toContain("ESP32");
      expect(summary.items.some((item) => item.kind === "bumper")).toBe(false);

      const leftWheelItem = summary.items.find(
        (item) => item.partId === "wheel-front-left"
      )!;
      expect(leftWheelItem.categoryLabel).toBe("Wheel");
      expect(leftWheelItem.drivetrainSide).toBe("left");
      expect(leftWheelItem.detailTag).toBe("Left Drive");
      expect(leftWheelItem.dimensionsLabel).toContain("0.22");
    });

    it("mounts Workshop motors inside chassis side pockets clear of top plate deck", () => {
      const fixture = buildWorkshopAssemblyFixture("4wd", true);
      const chassis = fixture.parts.find((p) => p.id === "foundation-chassis")!;
      const topPlate = fixture.parts.find(
        (p) => p.id === "foundation-top-plate"
      )!;
      const motors = fixture.parts.filter((p) => p.type === "Motor");

      expect(motors).toHaveLength(4);
      const topPlateBottom = topPlate.position[1] - topPlate.size[1] * 0.5;
      for (const motor of motors) {
        expect(motor.position[1]).toBeGreaterThan(0);
        expect(motor.position[1]).toBeLessThan(chassis.size[1]);
        expect(motor.position[1] + motor.size[1] * 0.5).toBeLessThanOrEqual(
          topPlateBottom + 0.02
        );
        expect(Math.abs(motor.position[2])).toBeLessThan(chassis.size[2] * 0.5);
      }
    });
  });
});
