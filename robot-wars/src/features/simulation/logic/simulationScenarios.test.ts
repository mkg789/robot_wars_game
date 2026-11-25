import { describe, expect, it } from "vitest";
import {
  createRectangularArena,
  STANDARD_ROBOT_WARS_ARENA,
} from "./arenaModel";
import { deriveRobotFootprintDimensions } from "./collisionModel";
import { bodyToWorldVelocity } from "./collisionResponse";
import {
  createInitialSimulationState,
  stepDrivetrainDynamics,
} from "./drivetrainDynamics";
import {
  advanceSimulation,
  createInitialRunnerState,
  DEFAULT_FIXED_TIMESTEP_SECONDS,
  resetBatteryCutoff,
} from "./simulationRunner";
import {
  assertFiniteSimulationState,
  buildCompiledCatalogueRobot,
  computeRobotKineticEnergy,
  runSimulationScenario,
} from "./simulationScenarioTestHelpers";

describe("Phase 4.1.5: Simulation Stability & Scenario Validation", () => {
  const arena12x12 = STANDARD_ROBOT_WARS_ARENA;
  const robot4WD = buildCompiledCatalogueRobot({ drivetrainType: "differential-4" });
  const robot2WD = buildCompiledCatalogueRobot({ drivetrainType: "differential-2" });
  const footprint4WD = deriveRobotFootprintDimensions(robot4WD);

  describe("Scenario A — Straight Driving (2WD & 4WD)", () => {
    it("validates forward driving, reverse driving, zero throttle, and straight-line stability", () => {
      for (const config of [robot4WD, robot2WD]) {
        // Forward driving
        const fwd = runSimulationScenario({
          config,
          baseOptions: { arena: arena12x12 },
          phases: [
            { durationSeconds: 1.0, frameDurationSeconds: 0.1, input: { leftThrottle: 1.0, rightThrottle: 1.0 } },
          ],
        });
        expect(fwd.totalSteps).toBe(120);
        expect(fwd.collisionSteps).toBe(0);
        expect(fwd.finalState.xMeters).toBeGreaterThan(0.5);
        expect(fwd.finalState.zMeters).toBeCloseTo(0, 6);
        expect(fwd.finalState.longitudinalVelocityMps).toBeGreaterThan(0);
        expect(fwd.finalState.lateralVelocityMps).toBe(0);
        expect(fwd.finalState.headingRadians).toBeCloseTo(0, 6);
        expect(fwd.finalState.yawRateRadPerSec).toBe(0);

        // Reverse driving
        const rev = runSimulationScenario({
          config,
          baseOptions: { arena: arena12x12 },
          phases: [
            { durationSeconds: 1.0, frameDurationSeconds: 0.1, input: { leftThrottle: -1.0, rightThrottle: -1.0 } },
          ],
        });
        expect(rev.finalState.xMeters).toBeCloseTo(-fwd.finalState.xMeters, 5);
        expect(rev.finalState.longitudinalVelocityMps).toBeCloseTo(
          -fwd.finalState.longitudinalVelocityMps,
          5
        );
        expect(rev.finalState.zMeters).toBeCloseTo(0, 6);
        expect(rev.finalState.lateralVelocityMps).toBe(0);
        expect(rev.finalState.yawRateRadPerSec).toBe(0);

        // Zero throttle
        const idle = runSimulationScenario({
          config,
          baseOptions: { arena: arena12x12 },
          phases: [
            { durationSeconds: 1.0, frameDurationSeconds: 0.1, input: { leftThrottle: 0, rightThrottle: 0 } },
          ],
        });
        expect(idle.finalState.xMeters).toBe(0);
        expect(idle.finalState.zMeters).toBe(0);
        expect(idle.finalState.longitudinalVelocityMps).toBe(0);
        expect(idle.maxCurrentDrawA).toBe(0);
      }
    });
  });

  describe("Scenario B — Driving Into a Wall (Forward & Reverse)", () => {
    const compactArena = createRectangularArena({
      id: "scenario-b-arena",
      name: "Scenario B 6x6 Arena",
      lengthM: 6.0,
      widthM: 6.0,
      wallThicknessM: 0.2,
    });

    it("detects perimeter walls, prevents pass-through, and reduces speed cleanly in both forward and reverse", () => {
      const halfL = footprint4WD.lengthM / 2;

      const fwd = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 0.5, z: 0, heading: 0 },
        baseOptions: {
          arena: compactArena,
          collisionResponse: { restitution: 0.2, contactFrictionCoeff: 0.3 },
        },
        phases: [
          { durationSeconds: 2.5, frameDurationSeconds: 0.05, input: { leftThrottle: 1.0, rightThrottle: 1.0 } },
        ],
      });

      expect(fwd.collisionSteps).toBeGreaterThan(0);
      expect(fwd.finalState.xMeters).toBeLessThanOrEqual(3.0 - halfL + 0.005);
      expect(fwd.maxX).toBeLessThanOrEqual(3.0 - halfL + 0.02);
      expect(Math.abs(fwd.finalState.longitudinalVelocityMps)).toBeLessThan(0.05);
      expect(fwd.maxPenetrationM).toBeLessThan(0.05);

      // Reverse into South (-X) wall
      const rev = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: -0.5, z: 0, heading: 0 },
        baseOptions: {
          arena: compactArena,
          collisionResponse: { restitution: 0.2, contactFrictionCoeff: 0.3 },
        },
        phases: [
          { durationSeconds: 2.5, frameDurationSeconds: 0.05, input: { leftThrottle: -1.0, rightThrottle: -1.0 } },
        ],
      });

      expect(rev.collisionSteps).toBeGreaterThan(0);
      expect(rev.finalState.xMeters).toBeGreaterThanOrEqual(-3.0 + halfL - 0.005);
      expect(rev.minX).toBeGreaterThanOrEqual(-3.0 + halfL - 0.02);
      expect(Math.abs(rev.finalState.longitudinalVelocityMps)).toBeLessThan(0.05);
    });
  });

  describe("Scenario C — Sustained Throttle Against a Wall", () => {
    it("remains stable over 5 seconds (600 steps) without micro-bouncing, angular drift, or NaN even for high-power 4WD", () => {
      const highPower4WD = buildCompiledCatalogueRobot({
        drivetrainType: "differential-4",
        foundationModelId: "compact-square",
        chassisMassKg: 2.0,
        motorId: "standard-dc",
        batteryId: "heavy-duty-lipo",
      });
      const fp = deriveRobotFootprintDimensions(highPower4WD);
      const halfL = fp.lengthM / 2;

      const summary = runSimulationScenario({
        config: highPower4WD,
        initialPose: { x: 6.0 - halfL - 0.1, z: 0, heading: 0 },
        baseOptions: {
          arena: arena12x12,
          collisionResponse: { restitution: 0.25, contactFrictionCoeff: 0.3 },
        },
        phases: [
          { durationSeconds: 5.0, frameDurationSeconds: 0.05, input: { leftThrottle: 1.0, rightThrottle: 1.0 } },
        ],
      });

      expect(summary.totalSteps).toBe(600);
      expect(summary.collisionSteps).toBeGreaterThan(500);
      expect(summary.finalState.xMeters).toBeLessThanOrEqual(6.0 - halfL + 0.005);
      expect(summary.finalState.xMeters).toBeGreaterThan(6.0 - halfL - 0.01);

      // Verify zero persistent micro-bouncing in final 50 steps
      const lastResults = summary.advanceResults.slice(-5);
      for (const adv of lastResults) {
        for (const step of adv.stepDiagnostics) {
          expect(Math.abs(step.state.longitudinalVelocityMps)).toBeLessThan(1e-6);
          expect(Math.abs(step.state.yawRateRadPerSec)).toBeLessThan(1e-6);
          expect(step.collisionResponse?.contacts[0]?.penetrationDepthM ?? 0).toBeLessThan(0.005);
        }
      }

      // Battery and motor remain actively loaded while stalled/slipping against wall
      expect(summary.finalState.batteryTerminalVoltageV).toBeGreaterThan(0);
      expect(summary.finalState.batteryTerminalVoltageV).toBeLessThan(
        highPower4WD.battery!.fullyChargedVoltageV!
      );
      expect(summary.finalState.totalCurrentDrawA).toBeGreaterThan(0);
    });
  });

  describe("Scenario D — Angled Barrier Collision", () => {
    const barrierArena = createRectangularArena({
      id: "scenario-d-arena",
      name: "Scenario D Barrier Arena",
      lengthM: 10.0,
      widthM: 10.0,
      wallThicknessM: 0.2,
      barriers: [
        {
          id: "center-block",
          name: "Center Block",
          isPerimeter: false,
          geometryType: "rectangle",
          position: { x: 2.0, z: 0.0 },
          sizeX: 1.0,
          sizeZ: 2.0,
        },
      ],
    });

    it("resolves angled impacts across multiple approach orientations without energy injection", () => {
      const headings = [Math.PI / 6, -Math.PI / 4];

      for (const heading of headings) {
        // Coast into center-block (X in [1.5, 2.5], Z in [-1, 1]) at an angled heading
        const summary = runSimulationScenario({
          config: robot4WD,
          initialPose: {
            x: 0.4,
            z: 0,
            heading,
          },
          initialStateMutator: (s) => ({
            ...s,
            longitudinalVelocityMps: 2.5,
          }),
          baseOptions: {
            arena: barrierArena,
            collisionResponse: { restitution: 0.3, contactFrictionCoeff: 0.3 },
          },
          phases: [
            { durationSeconds: 0.8, frameDurationSeconds: 0.05, input: { leftThrottle: 0, rightThrottle: 0 } },
          ],
        });

        expect(summary.collisionSteps).toBeGreaterThan(0);
        // Unpowered impact must not exceed initial kinetic energy
        expect(summary.finalKineticEnergyJ).toBeLessThanOrEqual(
          summary.maxKineticEnergyJ + 1e-9
        );
        // Angled impact against barrier induces both yaw and lateral velocity
        expect(summary.maxYawRateRadPerSec).toBeGreaterThan(0.1);
        expect(Math.abs(summary.finalState.lateralVelocityMps)).toBeGreaterThan(0.01);
      }
    });
  });

  describe("Scenario E — Offset Impact & Inertia Influence", () => {
    it("generates opposite yaw directions for left vs right offsets and scales inversely with inertia", () => {
      // Same total mass, different yaw inertia via parallel-axis payload placement
      const lowInertiaRobot = buildCompiledCatalogueRobot({
        drivetrainType: "differential-4",
        extraMassBlocks: [
          { massKg: 2.0, position: [0, 0.3, 0.05] },
          { massKg: 2.0, position: [0, 0.3, -0.05] },
        ],
      });
      const highInertiaRobot = buildCompiledCatalogueRobot({
        drivetrainType: "differential-4",
        extraMassBlocks: [
          { massKg: 2.0, position: [0, 0.3, 0.65] },
          { massKg: 2.0, position: [0, 0.3, -0.65] },
        ],
      });
      expect(highInertiaRobot.totalMassKg).toBeCloseTo(lowInertiaRobot.totalMassKg, 6);
      expect(highInertiaRobot.yawInertiaKgM2).toBeGreaterThan(lowInertiaRobot.yawInertiaKgM2);

      const runOffsetImpact = (
        config: typeof robot4WD,
        zOffsetSign: 1 | -1
      ) => {
        const arena = createRectangularArena({
          id: `offset-arena-${zOffsetSign}`,
          name: "Offset Impact Arena",
          lengthM: 10,
          widthM: 10,
          barriers: [
            {
              id: "offset-post",
              isPerimeter: false,
              geometryType: "rectangle",
              // Offset in Z so only left (+1) or right (-1) edge of front face strikes
              position: { x: 1.5, z: zOffsetSign * 0.7 },
              sizeX: 0.6,
              sizeZ: 0.6,
            },
          ],
        });

        return runSimulationScenario({
          config,
          initialPose: { x: 0.1, z: 0, heading: 0 },
          initialStateMutator: (s) => ({ ...s, longitudinalVelocityMps: 2.0 }),
          baseOptions: {
            arena,
            collisionResponse: { restitution: 0.2, contactFrictionCoeff: 0.25 },
          },
          phases: [
            { durationSeconds: 0.4, frameDurationSeconds: 1 / 120, input: { leftThrottle: 0, rightThrottle: 0 } },
          ],
        });
      };

      const leftHit = runOffsetImpact(lowInertiaRobot, 1);
      const rightHit = runOffsetImpact(lowInertiaRobot, -1);
      const highInertiaLeftHit = runOffsetImpact(highInertiaRobot, 1);

      expect(leftHit.collisionSteps).toBeGreaterThan(0);
      expect(rightHit.collisionSteps).toBeGreaterThan(0);

      // Front-left hit (+Z) pushes left nose back (-X) -> positive CCW yaw
      expect(leftHit.finalState.yawRateRadPerSec).toBeGreaterThan(0.1);
      // Front-right hit (-Z) pushes right nose back (-X) -> negative CW yaw
      expect(rightHit.finalState.yawRateRadPerSec).toBeLessThan(-0.1);
      // Exact mirror symmetry
      expect(leftHit.finalState.yawRateRadPerSec).toBeCloseTo(
        -rightHit.finalState.yawRateRadPerSec,
        4
      );
      // Higher yaw inertia (with equal mass) produces smaller angular velocity response
      expect(Math.abs(highInertiaLeftHit.finalState.yawRateRadPerSec)).toBeLessThan(
        Math.abs(leftHit.finalState.yawRateRadPerSec)
      );
    });
  });

  describe("Scenario F — Corner Collision (Shallow & Severe)", () => {
    const cornerArena = createRectangularArena({
      id: "corner-arena",
      name: "Corner Arena 6x6",
      lengthM: 6.0,
      widthM: 6.0,
      wallThicknessM: 0.2,
    });

    it("resolves simultaneous North+West corner contacts deterministically for both shallow and deep penetrations", () => {
      // Shallow approach into corner under throttle
      const shallow = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 1.5, z: 1.5, heading: Math.PI / 4 },
        baseOptions: {
          arena: cornerArena,
          collisionResponse: { restitution: 0.2, contactFrictionCoeff: 0.3 },
        },
        phases: [
          { durationSeconds: 2.0, frameDurationSeconds: 0.05, input: { leftThrottle: 1.0, rightThrottle: 1.0 } },
        ],
      });

      const multiContactSteps = shallow.advanceResults
        .flatMap((r) => r.stepDiagnostics)
        .filter((d) => (d.collisionResponse?.contactCount ?? 0) >= 2);
      expect(multiContactSteps.length).toBeGreaterThan(0);

      // Verify deterministic barrier ordering in multi-contact steps
      for (const step of multiContactSteps) {
        const ids = step.collisionResponse!.contacts.map((c) => c.barrierId);
        const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
        expect(ids).toEqual(sortedIds);
      }

      expect(shallow.finalState.xMeters).toBeLessThan(3.0);
      expect(shallow.finalState.zMeters).toBeLessThan(3.0);
      expect(shallow.maxLinearSpeedMps).toBeLessThan(5.0);

      // Severe corner penetration recovery (spawned deep into corner)
      const severe = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 2.6, z: 2.6, heading: Math.PI / 4 },
        baseOptions: {
          arena: cornerArena,
          collisionResponse: {
            restitution: 0.1,
            contactFrictionCoeff: 0.3,
            maxPenetrationCorrectionM: 0.1,
          },
        },
        phases: [
          { durationSeconds: 0.5, frameDurationSeconds: 1 / 120, input: { leftThrottle: 0, rightThrottle: 0 } },
        ],
      });

      // Bounded single-step correction gradually pushes robot back inside arena bounds
      expect(severe.finalState.xMeters).toBeLessThan(2.6);
      expect(severe.finalState.zMeters).toBeLessThan(2.6);
      expect(severe.finalState.longitudinalVelocityMps).toBe(0);
      expect(severe.finalState.lateralVelocityMps).toBe(0);
    });
  });

  describe("Scenario G — Driving Away After Contact", () => {
    it("allows robot to separate cleanly when throttle reverses without false impulses or pull-back", () => {
      const summary = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 4.5, z: 0, heading: 0 },
        baseOptions: {
          arena: arena12x12,
          collisionResponse: { restitution: 0.1, contactFrictionCoeff: 0.3 },
        },
        phases: [
          // Phase 1: push into North wall (+X)
          { durationSeconds: 1.5, frameDurationSeconds: 0.05, input: { leftThrottle: 1.0, rightThrottle: 1.0 } },
          // Phase 2: reverse away (-X)
          { durationSeconds: 1.0, frameDurationSeconds: 0.05, input: { leftThrottle: -1.0, rightThrottle: -1.0 } },
        ],
      });

      const phase1Final = summary.advanceResults[29].runnerState.simulationState;
      expect(phase1Final.xMeters).toBeGreaterThan(4.9);

      // Phase 2 must move cleanly away from the North wall
      expect(summary.finalState.xMeters).toBeLessThan(phase1Final.xMeters - 0.5);
      expect(summary.finalState.longitudinalVelocityMps).toBeLessThan(-0.5);

      // Verify separating steps do not apply normal impulses
      const phase2Steps = summary.advanceResults
        .slice(30)
        .flatMap((r) => r.stepDiagnostics);
      for (const step of phase2Steps) {
        if (step.collisionResponse?.hasCollisions) {
          for (const c of step.collisionResponse.contacts) {
            if (!c.wasApproaching) {
              expect(c.normalImpulseNs).toBe(0);
            }
          }
        }
      }
    });
  });

  describe("Scenario H — Battery Cutoff During Contact", () => {
    it("latches cutoff during sustained wall contact, clamps drivetrain output, and recovers on reset", () => {
      const cutoffOptions = {
        arena: arena12x12,
        battery: {
          internalResistanceOhm: 0.25,
          cutoffVoltageV: 11.8, // High enough that heavy stall sag triggers cutoff
        },
        collisionResponse: { restitution: 0.2, contactFrictionCoeff: 0.3 },
      };

      let runner = createInitialRunnerState(
        robot4WD,
        { x: 6.0 - footprint4WD.lengthM / 2 - 0.02, z: 0, heading: 0 },
        cutoffOptions
      );

      // Push into wall until cutoff trips
      for (let i = 0; i < 30; i++) {
        const res = advanceSimulation(
          robot4WD,
          runner,
          { leftThrottle: 1.0, rightThrottle: 1.0 },
          0.05,
          cutoffOptions
        );
        runner = res.runnerState;
      }

      expect(runner.isCutoff).toBe(true);
      expect(runner.simulationState.isBatteryCutoff).toBe(true);
      expect(runner.simulationState.batteryTerminalVoltageV).toBe(0);
      expect(runner.simulationState.totalCurrentDrawA).toBe(0);
      expect(runner.simulationState.netDriveForceN).toBe(0);
      expect(runner.simulationState.longitudinalAccelerationMps2).toBe(0);
      assertFiniteSimulationState(runner.simulationState);

      // Reset cutoff latch with safe threshold and reverse out of the wall
      const resetRunner = resetBatteryCutoff(runner);
      expect(resetRunner.isCutoff).toBe(false);

      const postReset = advanceSimulation(
        robot4WD,
        resetRunner,
        { leftThrottle: -1.0, rightThrottle: -1.0 },
        0.5,
        {
          arena: arena12x12,
          battery: { internalResistanceOhm: 0.025, cutoffVoltageV: 9.0 },
        }
      );

      expect(postReset.runnerState.isCutoff).toBe(false);
      expect(postReset.runnerState.simulationState.longitudinalVelocityMps).toBeLessThan(0);
      expect(postReset.runnerState.simulationState.xMeters).toBeLessThan(
        runner.simulationState.xMeters
      );
    });
  });

  describe("Scenario I — Repeated Impacts & Energy Decay", () => {
    const corridorArena = createRectangularArena({
      id: "corridor-arena",
      name: "Corridor Arena",
      lengthM: 3.0,
      widthM: 6.0,
      wallThicknessM: 0.2,
    });

    it("maintains decaying kinetic energy and bounded response across repeated unpowered wall bounces", () => {
      // Coasting robot bouncing repeatedly between X = +1.5 and X = -1.5 walls
      const summary = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 0, z: 0, heading: 0 },
        initialStateMutator: (s) => ({ ...s, longitudinalVelocityMps: 3.0 }),
        baseOptions: {
          arena: corridorArena,
          collisionResponse: {
            restitution: 0.6,
            contactFrictionCoeff: 0.2,
            restitutionVelocityThresholdMps: 0.1,
          },
        },
        phases: [
          { durationSeconds: 4.5, frameDurationSeconds: 0.05, input: { leftThrottle: 0, rightThrottle: 0 } },
        ],
      });

      const impactEnergies: number[] = [];
      for (const adv of summary.advanceResults) {
        for (const step of adv.stepDiagnostics) {
          if (
            step.collisionResponse?.hasCollisions &&
            step.collisionResponse.totalNormalImpulseNs > 0
          ) {
            impactEnergies.push(step.collisionResponse.kineticEnergyAfterJ);
            expect(step.collisionResponse.kineticEnergyAfterJ).toBeLessThanOrEqual(
              step.collisionResponse.kineticEnergyBeforeJ + 1e-9
            );
          }
        }
      }

      // Multiple distinct impacts must have occurred between the two opposing walls
      expect(impactEnergies.length).toBeGreaterThanOrEqual(3);
      // Kinetic energy must decay monotonically across bounces
      for (let i = 1; i < impactEnergies.length; i++) {
        expect(impactEnergies[i]).toBeLessThanOrEqual(impactEnergies[i - 1] + 1e-9);
      }
      expect(summary.finalKineticEnergyJ).toBeLessThan(
        computeRobotKineticEnergy(robot4WD, {
          ...createInitialSimulationState(),
          longitudinalVelocityMps: 3.0,
        }).totalJ
      );
    });
  });

  describe("Scenario J — Long-Duration Stability (10s / 1200 steps)", () => {
    it("remains finite, bounded, and drift-free over 1200 fixed steps across mixed regimes", () => {
      const longArena = createRectangularArena({
        id: "long-arena",
        name: "Long Duration Arena 8x8",
        lengthM: 8.0,
        widthM: 8.0,
        wallThicknessM: 0.2,
        barriers: [
          {
            id: "mid-barrier",
            isPerimeter: false,
            geometryType: "rectangle",
            position: { x: 1.5, z: 0.5 },
            sizeX: 0.8,
            sizeZ: 0.8,
          },
        ],
      });

      const summary = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: -2.0, z: 0, heading: 0.15 },
        baseOptions: {
          arena: longArena,
          collisionResponse: { restitution: 0.25, contactFrictionCoeff: 0.3 },
        },
        phases: [
          // Drive unobstructed -> hit barrier -> drive into wall/corner -> reverse -> coast
          { durationSeconds: 3.0, frameDurationSeconds: 0.05, input: { leftThrottle: 1.0, rightThrottle: 1.0 } },
          { durationSeconds: 2.5, frameDurationSeconds: 0.05, input: { leftThrottle: 0.8, rightThrottle: 1.0 } },
          { durationSeconds: 2.5, frameDurationSeconds: 0.05, input: { leftThrottle: -0.9, rightThrottle: -0.7 } },
          { durationSeconds: 2.0, frameDurationSeconds: 0.05, input: { leftThrottle: 0, rightThrottle: 0 } },
        ],
      });

      expect(summary.totalSteps).toBe(1200);
      expect(summary.collisionSteps).toBeGreaterThan(0);
      expect(summary.minX).toBeGreaterThan(-4.0);
      expect(summary.maxX).toBeLessThan(4.0);
      expect(summary.minZ).toBeGreaterThan(-4.0);
      expect(summary.maxZ).toBeLessThan(4.0);
      expect(summary.maxPenetrationM).toBeLessThan(0.05);
      expect(summary.maxLinearSpeedMps).toBeLessThan(10.0);
      expect(summary.maxYawRateRadPerSec).toBeLessThan(20.0);
    });

    it("remains stable over extended runs at zero throttle, low-speed contact, and corner confinement", () => {
      // Zero throttle rest for 5 seconds
      const zeroRun = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 0, z: 0, heading: 0.25 },
        baseOptions: { arena: arena12x12 },
        phases: [
          { durationSeconds: 5.0, frameDurationSeconds: 0.1, input: { leftThrottle: 0, rightThrottle: 0 } },
        ],
      });
      expect(zeroRun.totalSteps).toBe(600);
      expect(zeroRun.finalState.xMeters).toBe(0);
      expect(zeroRun.finalState.zMeters).toBe(0);
      expect(zeroRun.finalKineticEnergyJ).toBe(0);

      // Low-speed contact (5% throttle into wall) for 5 seconds
      const lowSpeedRun = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 6.0 - footprint4WD.lengthM / 2 - 0.05, z: 0, heading: 0 },
        baseOptions: { arena: arena12x12 },
        phases: [
          { durationSeconds: 5.0, frameDurationSeconds: 0.05, input: { leftThrottle: 0.05, rightThrottle: 0.05 } },
        ],
      });
      expect(lowSpeedRun.collisionSteps).toBeGreaterThan(0);
      expect(lowSpeedRun.maxPenetrationM).toBeLessThan(0.005);
      expect(Math.abs(lowSpeedRun.finalState.longitudinalVelocityMps)).toBeLessThan(1e-4);

      // Extended corner confinement for 5 seconds
      const cornerRun = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 4.8, z: 4.8, heading: Math.PI / 4 },
        baseOptions: { arena: arena12x12 },
        phases: [
          { durationSeconds: 5.0, frameDurationSeconds: 0.05, input: { leftThrottle: 1.0, rightThrottle: 1.0 } },
        ],
      });
      expect(cornerRun.totalSteps).toBe(600);
      expect(cornerRun.maxX).toBeLessThan(6.0);
      expect(cornerRun.maxZ).toBeLessThan(6.0);
      expect(cornerRun.maxPenetrationM).toBeLessThan(0.05);
    });
  });

  describe("Scenario K — Fixed Timestep Consistency", () => {
    it("produces identical final state for the same simulated time regardless of frame request chunking", () => {
      const options = {
        arena: arena12x12,
        collisionResponse: { restitution: 0.3, contactFrictionCoeff: 0.25 },
      };
      const input = { leftThrottle: 0.85, rightThrottle: 1.0 };
      const initialPose = { x: 4.5, z: 4.0, heading: 0.4 };

      // Run 1: exact 1/120 s steps for 1.0 s (120 steps)
      const runFixed = runSimulationScenario({
        config: robot4WD,
        initialPose,
        baseOptions: options,
        phases: [
          {
            durationSeconds: 1.0,
            frameDurationSeconds: DEFAULT_FIXED_TIMESTEP_SECONDS,
            input,
          },
        ],
      });

      // Run 2: 0.01 s frames (irregular relative to 1/120 s) for 1.0 s (also 120 physics steps)
      const runIrregular = runSimulationScenario({
        config: robot4WD,
        initialPose,
        baseOptions: options,
        phases: [
          { durationSeconds: 1.0, frameDurationSeconds: 0.01, input },
        ],
      });

      // Run 3: 0.05 s coarse frames (6 steps per call) for 1.0 s (120 steps)
      const runCoarse = runSimulationScenario({
        config: robot4WD,
        initialPose,
        baseOptions: options,
        phases: [
          { durationSeconds: 1.0, frameDurationSeconds: 0.05, input },
        ],
      });

      expect(runFixed.totalSteps).toBe(120);
      expect(runIrregular.totalSteps).toBe(120);
      expect(runCoarse.totalSteps).toBe(120);

      expect(runIrregular.finalState).toEqual(runFixed.finalState);
      expect(runCoarse.finalState).toEqual(runFixed.finalState);
    });
  });

  describe("Scenario L — Determinism & Energy Accounting Audit", () => {
    it("produces bit-identical state and diagnostics across repeated identical runs", () => {
      const params = {
        config: robot4WD,
        initialPose: { x: 4.2, z: 3.8, heading: 0.6 },
        baseOptions: {
          arena: arena12x12,
          collisionResponse: { restitution: 0.35, contactFrictionCoeff: 0.3 },
        },
        phases: [
          { durationSeconds: 0.5, frameDurationSeconds: 0.02, input: { leftThrottle: 0.9, rightThrottle: 0.6 } },
          { durationSeconds: 0.5, frameDurationSeconds: 0.03, input: { leftThrottle: -0.5, rightThrottle: -0.8 } },
        ],
      } as const;

      const runA = runSimulationScenario(params);
      const runB = runSimulationScenario(params);

      expect(runA.finalRunnerState).toEqual(runB.finalRunnerState);
      expect(runA.advanceResults).toEqual(runB.advanceResults);
    });

    it("distinguishes motor energy injection, contact dissipation, and zero-velocity positional correction", () => {
      // 1. Powered acceleration injects kinetic energy
      const accelRun = runSimulationScenario({
        config: robot4WD,
        baseOptions: { arena: arena12x12 },
        phases: [
          { durationSeconds: 0.5, frameDurationSeconds: 0.05, input: { leftThrottle: 1.0, rightThrottle: 1.0 } },
        ],
      });
      expect(accelRun.finalKineticEnergyJ).toBeGreaterThan(0);

      // 2. Unpowered elastic centered collision (e=1, mu=0) preserves kinetic energy; inelastic/frictional dissipates it
      const elasticRun = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 5.0, z: 0, heading: 0 },
        initialStateMutator: (s) => ({ ...s, longitudinalVelocityMps: 2.0 }),
        baseOptions: {
          arena: arena12x12,
          collisionResponse: { restitution: 1.0, contactFrictionCoeff: 0 },
        },
        phases: [
          { durationSeconds: 0.25, frameDurationSeconds: 1 / 120, input: { leftThrottle: 0, rightThrottle: 0 } },
        ],
      });
      const initialKE = computeRobotKineticEnergy(robot4WD, {
        ...createInitialSimulationState(),
        longitudinalVelocityMps: 2.0,
      }).totalJ;
      expect(elasticRun.collisionSteps).toBeGreaterThan(0);
      expect(elasticRun.finalKineticEnergyJ).toBeCloseTo(initialKE, 5);

      // 3. Pure positional correction at zero velocity introduces zero kinetic energy
      const staticOverlapRun = runSimulationScenario({
        config: robot4WD,
        initialPose: { x: 6.0 - footprint4WD.lengthM / 2 + 0.04, z: 0, heading: 0 },
        baseOptions: {
          arena: arena12x12,
          collisionResponse: { restitution: 0.5, contactFrictionCoeff: 0.5 },
        },
        phases: [
          { durationSeconds: 0.1, frameDurationSeconds: 1 / 120, input: { leftThrottle: 0, rightThrottle: 0 } },
        ],
      });
      expect(staticOverlapRun.collisionSteps).toBeGreaterThan(0);
      expect(staticOverlapRun.finalKineticEnergyJ).toBe(0);

      // 4. Verify world velocity alignment after rotated bounce
      const rotatedVel = bodyToWorldVelocity(
        elasticRun.finalState.longitudinalVelocityMps,
        elasticRun.finalState.lateralVelocityMps,
        elasticRun.finalState.headingRadians
      );
      expect(rotatedVel.x).toBeCloseTo(-2.0, 4);
    });

    it("rejects non-finite kinematic state and negative accumulator deterministically", () => {
      const baseState = createInitialSimulationState();
      expect(() =>
        stepDrivetrainDynamics(
          robot4WD,
          { ...baseState, longitudinalVelocityMps: Number.NaN },
          { leftThrottle: 0, rightThrottle: 0 },
          1 / 120
        )
      ).toThrow(/Invalid currentState/);

      expect(() =>
        stepDrivetrainDynamics(
          robot4WD,
          { ...baseState, lateralVelocityMps: Infinity },
          { leftThrottle: 0, rightThrottle: 0 },
          1 / 120
        )
      ).toThrow(/Invalid currentState/);

      const runnerState = createInitialRunnerState(robot4WD);
      expect(() =>
        advanceSimulation(
          robot4WD,
          { ...runnerState, accumulatorSeconds: -0.01 },
          { leftThrottle: 0, rightThrottle: 0 },
          0.05
        )
      ).toThrow(/accumulatorSeconds/);
    });
  });
});
