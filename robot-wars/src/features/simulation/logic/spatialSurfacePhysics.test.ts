import { describe, expect, it } from "vitest";
import {
  createRectangularArena,
  createRectangularSurfaceZone,
} from "./arenaModel";
import {
  createInitialSimulationState,
  resolveWheelContactWorldPosition,
  resolveWheelGroundSurface,
  stepDrivetrainDynamics,
} from "./drivetrainDynamics";
import {
  advanceSimulation,
  createInitialRunnerState,
} from "./simulationRunner";
import { buildCompiledCatalogueRobot } from "./simulationScenarioTestHelpers";
import { SimulationWorld } from "./simulationWorld";
import { SURFACE_PRESETS } from "./surfaceModel";

describe("Phase 4.3: Spatial Surface Physics Integration", () => {
  // Real compiled 4WD robot using high-torque motors so traction limits engage on low-grip surfaces
  const robot4WD = buildCompiledCatalogueRobot({
    drivetrainType: "differential-4",
    foundationModelId: "compact-square",
    chassisMassKg: 4.0,
    motorId: "high-torque-dc",
    wheelId: "standard-rubber",
    batteryId: "heavy-duty-lipo",
  });

  // 2WD robot for single-axle sampling verification
  const robot2WD = buildCompiledCatalogueRobot({
    drivetrainType: "differential-2",
    foundationModelId: "compact-square",
    chassisMassKg: 4.0,
    motorId: "high-torque-dc",
    wheelId: "standard-rubber",
    batteryId: "heavy-duty-lipo",
  });

  describe("1. Per-Wheel Contact Sampling & Spatial Zone Resolution", () => {
    const multiZoneArena = createRectangularArena({
      id: "multi-zone-arena",
      name: "Multi-Zone Test Arena",
      lengthM: 20,
      widthM: 20,
      fallbackSurface: "steel",
      surfaceZones: [
        createRectangularSurfaceZone({
          id: "zone-ice",
          bounds: { minX: 1, maxX: 6, minZ: -5, maxZ: 5 },
          surface: "low-grip",
          priority: 1,
        }),
        createRectangularSurfaceZone({
          id: "zone-high-grip-override",
          bounds: { minX: 2, maxX: 4, minZ: -2, maxZ: 2 },
          surface: "rubber-high-grip",
          priority: 5,
        }),
        // Equal-priority overlapping zones for deterministic tie-breaking by ID
        createRectangularSurfaceZone({
          id: "zone-tie-b",
          bounds: { minX: -6, maxX: -2, minZ: -2, maxZ: 2 },
          surface: "low-grip",
          priority: 2,
        }),
        createRectangularSurfaceZone({
          id: "zone-tie-a",
          bounds: { minX: -6, maxX: -2, minZ: -2, maxZ: 2 },
          surface: "wood",
          priority: 2,
        }),
      ],
    });

    it("computes rotated world wheel contact positions accurately", () => {
      const stateHeading90 = createInitialSimulationState({
        x: 2.0,
        z: 3.0,
        heading: Math.PI / 2, // +X_local points along +Z_world, +Z_local points along -X_world
      });

      const flWheel = robot4WD.wheels.find(
        (w) => w.side === "left" && w.slotIndex === 0
      )!;
      const worldPos = resolveWheelContactWorldPosition(
        robot4WD,
        stateHeading90,
        flWheel
      );

      // Local (+x, +z) rotated +90 deg CCW -> (-z, +x)
      expect(worldPos.x).toBeCloseTo(2.0 - flWheel.localPosition!.z, 5);
      expect(worldPos.z).toBeCloseTo(3.0 + flWheel.localPosition!.x, 5);
    });

    it("resolves fallback surface, zone priority, overlap precedence, tie-breaking, and outside-arena fallback", () => {
      const wheel = robot4WD.wheels[0];

      // 1. Inside fallback region (origin)
      const sOrigin = resolveWheelGroundSurface(
        robot4WD,
        createInitialSimulationState({ x: 0, z: 0 }),
        wheel,
        undefined,
        multiZoneArena
      );
      expect(sOrigin.surface.id).toBe("steel");

      // 2. Inside low-grip zone (x=5, outside priority-5 override)
      const sIce = resolveWheelGroundSurface(
        robot4WD,
        createInitialSimulationState({ x: 5, z: 0 }),
        wheel,
        undefined,
        multiZoneArena
      );
      expect(sIce.surface.id).toBe("low-grip");

      // 3. Inside overlapping priority-5 zone over priority-1 ice zone
      const sOverride = resolveWheelGroundSurface(
        robot4WD,
        createInitialSimulationState({ x: 3, z: 0 }),
        wheel,
        undefined,
        multiZoneArena
      );
      expect(sOverride.surface.id).toBe("rubber-high-grip");

      // 4. Equal-priority overlap deterministically selects "zone-tie-a" (wood) over "zone-tie-b" (low-grip)
      const sTie = resolveWheelGroundSurface(
        robot4WD,
        createInitialSimulationState({ x: -4, z: 0 }),
        wheel,
        undefined,
        multiZoneArena
      );
      expect(sTie.surface.id).toBe("wood");

      // 5. Outside arena bounds falls back cleanly to arena.fallbackSurface
      const sOutside = resolveWheelGroundSurface(
        robot4WD,
        createInitialSimulationState({ x: 25, z: 25 }),
        wheel,
        undefined,
        multiZoneArena
      );
      expect(sOutside.surface.id).toBe("steel");
    });
  });

  describe("2. Dynamic Traction & Straddling Behavior", () => {
    const splitArena = createRectangularArena({
      id: "split-surface-arena",
      name: "Split Surface Arena",
      lengthM: 20,
      widthM: 20,
      fallbackSurface: "steel",
      surfaceZones: [
        createRectangularSurfaceZone({
          id: "left-low-grip",
          bounds: { minX: -8, maxX: 8, minZ: 0.05, maxZ: 8 },
          surface: "low-grip",
          priority: 1,
        }),
        createRectangularSurfaceZone({
          id: "front-high-grip",
          bounds: { minX: 0.1, maxX: 8, minZ: -8, maxZ: -0.05 },
          surface: "rubber-high-grip",
          priority: 1,
        }),
      ],
    });

    it("produces lower acceleration and traction limit on low-grip zone than high-grip zone", () => {
      const arenaZones = createRectangularArena({
        id: "traction-compare-arena",
        name: "Traction Compare Arena",
        lengthM: 20,
        widthM: 20,
        fallbackSurface: "low-grip",
        surfaceZones: [
          createRectangularSurfaceZone({
            id: "high-grip-pad",
            bounds: { minX: 2, maxX: 8, minZ: -4, maxZ: 4 },
            surface: "rubber-high-grip",
            priority: 1,
          }),
        ],
      });

      const input = { leftThrottle: 1.0, rightThrottle: 1.0 };
      const dt = 1 / 120;

      const lowGripRes = stepDrivetrainDynamics(
        robot4WD,
        createInitialSimulationState({ x: -4, z: 0, heading: 0 }),
        input,
        dt,
        16.8,
        10,
        undefined,
        arenaZones
      );

      const highGripRes = stepDrivetrainDynamics(
        robot4WD,
        createInitialSimulationState({ x: 5, z: 0, heading: 0 }),
        input,
        dt,
        16.8,
        10,
        undefined,
        arenaZones
      );

      expect(lowGripRes.diagnostics.isTractionLimited).toBe(true);
      expect(lowGripRes.diagnostics.wheels.every((w) => w.surfaceId === "low-grip")).toBe(true);
      expect(highGripRes.diagnostics.wheels.every((w) => w.surfaceId === "rubber-high-grip")).toBe(true);

      expect(highGripRes.diagnostics.netLongitudinalForceN).toBeGreaterThan(
        lowGripRes.diagnostics.netLongitudinalForceN
      );
      expect(highGripRes.state.longitudinalAccelerationMps2).toBeGreaterThan(
        lowGripRes.state.longitudinalAccelerationMps2
      );
    });

    it("induces realistic yaw torque when robot straddles left low-grip and right high-grip surfaces", () => {
      // Robot centered at (1.5, 0) straddles Z = 0:
      // Left wheels (Z > +0.05) sit on "low-grip" (μ = 0.20)
      // Right wheels (Z < -0.05) sit on "rubber-high-grip" (μ = 1.15)
      const res = stepDrivetrainDynamics(
        robot4WD,
        createInitialSimulationState({ x: 1.5, z: 0, heading: 0 }),
        { leftThrottle: 1.0, rightThrottle: 1.0 },
        1 / 120,
        16.8,
        10,
        undefined,
        splitArena
      );

      const leftWheels = res.diagnostics.wheels.filter((w) => w.side === "left");
      const rightWheels = res.diagnostics.wheels.filter((w) => w.side === "right");

      expect(leftWheels.every((w) => w.surfaceId === "low-grip")).toBe(true);
      expect(rightWheels.every((w) => w.surfaceId === "rubber-high-grip")).toBe(true);
      expect(res.diagnostics.rightDriveForceN).toBeGreaterThan(
        res.diagnostics.leftDriveForceN
      );
      // Right push > Left push -> positive yaw torque turning toward low-grip (+Z) left side
      expect(res.diagnostics.netYawTorqueNm).toBeGreaterThan(0);
      expect(res.state.yawRateRadPerSec).toBeGreaterThan(0);
    });

    it("handles front-rear straddle cleanly for 4WD robot entering a surface zone", () => {
      const entryArena = createRectangularArena({
        id: "entry-arena",
        name: "Zone Entry Arena",
        lengthM: 20,
        widthM: 20,
        fallbackSurface: "steel",
        surfaceZones: [
          createRectangularSurfaceZone({
            id: "ice-patch",
            bounds: { minX: 0, maxX: 6, minZ: -6, maxZ: 6 },
            surface: "low-grip",
            priority: 1,
          }),
        ],
      });

      // Center at x = 0: front wheels (x > 0) are inside ice-patch, rear wheels (x < 0) are on steel
      const res = stepDrivetrainDynamics(
        robot4WD,
        createInitialSimulationState({ x: 0, z: 0, heading: 0 }),
        { leftThrottle: 1.0, rightThrottle: 1.0 },
        1 / 120,
        16.8,
        10,
        undefined,
        entryArena
      );

      const frontWheels = res.diagnostics.wheels.filter((w) => w.slotIndex === 0);
      const rearWheels = res.diagnostics.wheels.filter((w) => w.slotIndex === 1);
      expect(frontWheels.every((w) => w.surfaceId === "low-grip")).toBe(true);
      expect(rearWheels.every((w) => w.surfaceId === "steel")).toBe(true);
      expect(frontWheels.every((w) => w.isTractionLimited)).toBe(true);
    });
  });

  describe("3. Surface Transitions, Runner & SimulationWorld Integration", () => {
    const transitionArena = createRectangularArena({
      id: "transition-arena",
      name: "Surface Transition Arena",
      lengthM: 16,
      widthM: 16,
      fallbackSurface: "steel",
      surfaceZones: [
        createRectangularSurfaceZone({
          id: "ice-strip",
          bounds: { minX: 1.5, maxX: 4.5, minZ: -4, maxZ: 4 },
          surface: "low-grip",
          priority: 1,
        }),
      ],
    });

    it("crosses surface boundaries without artificial velocity discontinuities", () => {
      // Coast across boundary at 2.0 m/s with zero throttle: velocity must remain completely constant
      const runner0 = createInitialRunnerState(robot2WD, { x: 0.5, z: 0, heading: 0 });
      const coastingRunner = {
        ...runner0,
        simulationState: {
          ...runner0.simulationState,
          longitudinalVelocityMps: 2.0,
        },
      };

      let runner = coastingRunner;
      let sawSteelBefore = false;
      let sawIce = false;
      let sawSteelAfterExit = false;

      // 2.0 m/s for 2.5 s travels 5.0 m (from x = 0.5 through [1.5, 4.5] ice strip out to x = 5.5)
      for (let i = 0; i < 50; i++) {
        const res = advanceSimulation(
          robot2WD,
          runner,
          { leftThrottle: 0, rightThrottle: 0 },
          0.05,
          { arena: transitionArena }
        );
        for (const step of res.stepDiagnostics) {
          expect(step.state.longitudinalVelocityMps).toBeCloseTo(2.0, 6);
          const allSteel = step.diagnostics.wheels.every((w) => w.surfaceId === "steel");
          const allIce = step.diagnostics.wheels.every((w) => w.surfaceId === "low-grip");
          if (allSteel && !sawIce) {
            sawSteelBefore = true;
          }
          if (allIce) {
            sawIce = true;
          }
          if (allSteel && sawIce && step.state.xMeters > 4.6) {
            sawSteelAfterExit = true;
          }
        }
        runner = res.runnerState;
      }

      expect(sawSteelBefore).toBe(true);
      expect(sawIce).toBe(true);
      expect(sawSteelAfterExit).toBe(true);
    });

    it("produces different travel distances when accelerating across low-grip vs steel via advanceSimulation", () => {
      const steelOnlyArena = createRectangularArena({
        id: "steel-only",
        name: "Steel Only",
        lengthM: 16,
        widthM: 16,
        fallbackSurface: "steel",
      });
      const iceOnlyArena = createRectangularArena({
        id: "ice-only",
        name: "Ice Only",
        lengthM: 16,
        widthM: 16,
        fallbackSurface: "low-grip",
      });

      const runOn = (arena: typeof steelOnlyArena) => {
        let runner = createInitialRunnerState(robot4WD, { x: -4, z: 0, heading: 0 });
        for (let i = 0; i < 20; i++) {
          runner = advanceSimulation(
            robot4WD,
            runner,
            { leftThrottle: 1.0, rightThrottle: 1.0 },
            0.05,
            { arena }
          ).runnerState;
        }
        return runner.simulationState;
      };

      const steelFinal = runOn(steelOnlyArena);
      const iceFinal = runOn(iceOnlyArena);

      expect(steelFinal.xMeters).toBeGreaterThan(iceFinal.xMeters);
      expect(steelFinal.longitudinalVelocityMps).toBeGreaterThanOrEqual(
        iceFinal.longitudinalVelocityMps
      );
    });

    it("integrates seamlessly with SimulationWorld, reset, and deterministic execution", () => {
      const world = new SimulationWorld({
        robotConfig: robot4WD,
        arena: transitionArena,
        initialPose: { x: 0.5, z: 0, heading: 0 },
      });

      const runSequence = () => {
        world.start();
        world.setDriveControls({ forward: true });
        for (let i = 0; i < 30; i++) {
          world.stepFrame(0.05);
        }
        return {
          runnerState: world.getRunnerState(),
          lastWheels: world.getLatestStepDiagnostics()?.diagnostics.wheels ?? [],
        };
      };

      const firstRun = runSequence();
      expect(firstRun.runnerState.simulationState.xMeters).toBeGreaterThan(1.5);
      expect(
        firstRun.lastWheels.some((w) => w.surfaceId === "low-grip")
      ).toBe(true);

      // Reset and re-run deterministically
      world.reset();
      expect(world.getRunnerState().simulationState.xMeters).toBe(0.5);
      expect(world.getRunnerState().totalPhysicsSteps).toBe(0);

      const secondRun = runSequence();
      expect(secondRun.runnerState).toEqual(firstRun.runnerState);
      expect(secondRun.lastWheels).toEqual(firstRun.lastWheels);
    });

    it("preserves explicit global surface override compatibility when options.surface is provided", () => {
      const runner0 = createInitialRunnerState(robot4WD, { x: 3.0, z: 0, heading: 0 });
      // Position x=3.0 is inside ice-strip in transitionArena, but explicit surface override uses rubber-high-grip
      const res = advanceSimulation(
        robot4WD,
        runner0,
        { leftThrottle: 1.0, rightThrottle: 1.0 },
        1 / 120,
        {
          arena: transitionArena,
          surface: SURFACE_PRESETS["rubber-high-grip"],
        }
      );

      expect(
        res.stepDiagnostics[0].diagnostics.wheels.every(
          (w) => w.surfaceId === "rubber-high-grip"
        )
      ).toBe(true);
    });
  });
});
