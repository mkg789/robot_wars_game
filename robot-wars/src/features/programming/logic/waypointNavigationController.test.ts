import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import {
  assembleConfiguredRobotFixture,
  wireCommonGroundFixture,
} from "../../../../tests/fixtures/robotFixtures";
import { STANDARD_ROBOT_WARS_ARENA } from "../../simulation/logic/arenaModel";
import { SimulationWorld } from "../../simulation/logic/simulationWorld";
import { wrapNavigationAngleSigned } from "./waypointNavigationController";

function buildNavigationWorld(options?: {
  withEncoders?: boolean;
  withSwitchWiring?: boolean;
  drivetrainType?: "differential-2" | "differential-4";
  initialHeading?: number;
}) {
  const ids = assembleConfiguredRobotFixture({
    drivetrainType: options?.drivetrainType ?? "differential-2",
  });

  if (options?.withEncoders !== false) {
    useRobotStore.getState().installElectricalCatalogueItem(
      "elec-quadrature-encoder",
      { position: [0, 0.1, 0.25] }
    );
    useRobotStore.getState().installElectricalCatalogueItem(
      "elec-quadrature-encoder",
      { position: [0, 0.1, -0.25] }
    );
  }

  let switchId: string | null = null;
  if (options?.withSwitchWiring) {
    const store = useRobotStore.getState();
    switchId = store.installElectricalCatalogueItem("elec-power-switch")!;
    const escLeftId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-esc-brushed-30a")!;
    const escRightId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-esc-brushed-30a")!;
    const buckId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-buck-5v")!;
    const encoders = useRobotStore
      .getState()
      .parts.filter((p) => p.electricalCatalogueId === "elec-quadrature-encoder");

    const addConn = useRobotStore.getState().addElectricalConnection;
    addConn({
      sourcePartId: ids.batteryId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: switchId,
      targetInterfaceId: "sw-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: switchId,
      sourceInterfaceId: "sw-out",
      targetPartId: escLeftId,
      targetInterfaceId: "esc-bat-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: escLeftId,
      sourceInterfaceId: "esc-motor-out",
      targetPartId: ids.leftMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: switchId,
      sourceInterfaceId: "sw-out",
      targetPartId: escRightId,
      targetInterfaceId: "esc-bat-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: escRightId,
      sourceInterfaceId: "esc-motor-out",
      targetPartId: ids.rightMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: ids.batteryId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    for (const enc of encoders) {
      addConn({
        sourcePartId: buckId,
        sourceInterfaceId: "elec-buck-5v-pwr-out",
        targetPartId: enc.id,
        targetInterfaceId: "elec-quadrature-encoder-pwr-in",
        connectionType: "power",
        provenance: { method: "user-supplied" },
      });
    }
    wireCommonGroundFixture(
      [escLeftId, escRightId, buckId, ids.controllerId, ...encoders.map((e) => e.id)],
      ids.batteryId
    );
  }

  const st = useRobotStore.getState();
  const world = SimulationWorld.fromAssembly({
    parts: st.parts,
    connections: st.connections,
    drivetrain: st.drivetrain,
    foundation: st.foundation,
    electricalConnections: st.electricalConnections,
    arena: STANDARD_ROBOT_WARS_ARENA,
    initialPose:
      options?.initialHeading !== undefined
        ? { x: 0, z: 0, heading: options.initialHeading }
        : undefined,
  }).world!;

  return { world, ids, switchId };
}

describe("Phase 9.5: Waypoint Navigation & Local Trajectory Execution", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("navigates to a single diagonal waypoint and stops cleanly inside acceptance radius", () => {
    const { world } = buildNavigationWorld();
    world.start();

    const target = { xMeters: 1.0, zMeters: 0.6, label: "Goal A" };
    const started = world.navigateToWaypoint(target, {
      acceptanceRadiusMeters: 0.1,
      maxLinearSpeedMps: 0.9,
      maxAngularSpeedRadPerSec: 3.0,
      timeoutSeconds: 12,
    });

    expect(started.status).toBe("navigating");
    expect(started.isActive).toBe(true);
    expect(started.currentWaypointIndex).toBe(0);
    expect(started.totalWaypoints).toBe(1);
    expect(started.currentTarget).toEqual(target);
    expect(started.estimatedDistanceMeters).toBeCloseTo(Math.hypot(1.0, 0.6), 4);
    expect(started.desiredHeadingRadians).toBeCloseTo(Math.atan2(0.6, 1.0), 4);

    for (let i = 0; i < 480; i++) {
      world.stepFrame(1 / 60);
      if (!world.getNavigationState().isActive) break;
    }

    const done = world.getNavigationState();
    const odo = world.getOdometryState();
    expect(done.status).toBe("completed");
    expect(done.isActive).toBe(false);
    expect(done.completedWaypoints).toBe(1);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
    expect(
      Math.hypot(odo.pose.xMeters - target.xMeters, odo.pose.zMeters - target.zMeters)
    ).toBeLessThanOrEqual(0.11);
  });

  it("executes ordered multi-waypoint sequences, advancing cleanly without boundary oscillation", () => {
    const { world } = buildNavigationWorld();
    world.start();

    const waypoints = [
      { xMeters: 0.9, zMeters: 0, label: "Leg 1" },
      { xMeters: 0.9, zMeters: 0.8, label: "Leg 2" },
      { xMeters: 0.2, zMeters: 0.8, label: "Leg 3" },
    ];

    world.navigateWaypoints(waypoints, {
      acceptanceRadiusMeters: 0.12,
      maxLinearSpeedMps: 0.85,
      timeoutSeconds: 20,
    });

    const seenIndices = new Set<number>();
    let previousIndex = 0;
    let indexMonotonic = true;

    for (let i = 0; i < 900; i++) {
      world.stepFrame(1 / 60);
      const nav = world.getNavigationState();
      if (nav.currentWaypointIndex >= 0) {
        seenIndices.add(nav.currentWaypointIndex);
        if (nav.currentWaypointIndex < previousIndex) {
          indexMonotonic = false;
        }
        previousIndex = nav.currentWaypointIndex;
      }
      if (!nav.isActive) break;
    }

    const done = world.getNavigationState();
    const odo = world.getOdometryState();
    expect(indexMonotonic).toBe(true);
    expect(seenIndices).toEqual(new Set([0, 1, 2]));
    expect(done.status).toBe("completed");
    expect(done.completedWaypoints).toBe(3);
    expect(
      Math.hypot(odo.pose.xMeters - 0.2, odo.pose.zMeters - 0.8)
    ).toBeLessThanOrEqual(0.13);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("rotates cleanly in place for waypoints behind the robot and handles +-pi heading wraparound", () => {
    // Utility normalization check across +-pi boundaries
    expect(wrapNavigationAngleSigned(Math.PI + 0.2)).toBeCloseTo(-Math.PI + 0.2, 6);
    expect(wrapNavigationAngleSigned(-Math.PI - 0.2)).toBeCloseTo(Math.PI - 0.2, 6);

    // 1. Waypoint directly behind robot (-X when heading = 0): stops forward translation while turning
    const { world } = buildNavigationWorld();
    world.start();

    const behindStart = world.navigateToWaypoint(
      { xMeters: -0.9, zMeters: 0 },
      { acceptanceRadiusMeters: 0.12, timeoutSeconds: 12 }
    );
    expect(behindStart.status).toBe("navigating");
    expect(Math.abs(behindStart.headingErrorRadians)).toBeGreaterThan(2.9);
    expect(behindStart.targetLinearVelocityMps).toBe(0);
    expect(Math.abs(behindStart.targetAngularVelocityRadPerSec)).toBeGreaterThan(0.5);

    for (let i = 0; i < 600; i++) {
      world.stepFrame(1 / 60);
      if (!world.getNavigationState().isActive) break;
    }

    expect(world.getNavigationState().status).toBe("completed");
    expect(
      Math.hypot(
        world.getOdometryState().pose.xMeters - (-0.9),
        world.getOdometryState().pose.zMeters - 0
      )
    ).toBeLessThanOrEqual(0.13);

    // 2. Starting near +pi (-175 deg -> +175 deg target) turns short path cleanly across +-pi seam
    world.reset();
    world.start();
    world.resetOdometry({ xMeters: 0, zMeters: 0, headingRadians: 3.0 });
    // Target at (-1, -0.15): desired heading ~ -2.99 rad (shortest diff ~ +0.29 rad CCW across +pi -> -pi)
    const seamStart = world.navigateToWaypoint(
      { xMeters: -1.0, zMeters: -0.15 },
      { acceptanceRadiusMeters: 0.12, timeoutSeconds: 10 }
    );
    expect(seamStart.headingErrorRadians).toBeGreaterThan(0);
    expect(seamStart.headingErrorRadians).toBeLessThan(0.5);

    for (let i = 0; i < 480; i++) {
      world.stepFrame(1 / 60);
      if (!world.getNavigationState().isActive) break;
    }
    expect(world.getNavigationState().status).toBe("completed");
  });

  it("relies exclusively on encoder odometry pose rather than ground-truth simulation pose", () => {
    const { world } = buildNavigationWorld();
    world.start();

    // Offset odometry pose deliberately away from ground-truth (0, 0)
    world.resetOdometry({ xMeters: 2.0, zMeters: -1.0, headingRadians: 0 });
    const startTruth = world.getRenderPose();
    expect(startTruth.xMeters).toBeCloseTo(0, 6);

    // Command waypoint at (2.8, -1.0) in odometry coordinates -> robot should drive +0.8m forward
    world.navigateToWaypoint(
      { xMeters: 2.8, zMeters: -1.0 },
      { acceptanceRadiusMeters: 0.1, timeoutSeconds: 10 }
    );

    for (let i = 0; i < 420; i++) {
      world.stepFrame(1 / 60);
      if (!world.getNavigationState().isActive) break;
    }

    expect(world.getNavigationState().status).toBe("completed");
    expect(
      Math.hypot(
        world.getOdometryState().pose.xMeters - 2.8,
        world.getOdometryState().pose.zMeters - (-1.0)
      )
    ).toBeLessThanOrEqual(0.11);
    expect(
      Math.hypot(
        world.getRenderPose().xMeters - 0.8,
        world.getRenderPose().zMeters - 0
      )
    ).toBeLessThanOrEqual(0.11);
  });

  it("handles acceptance radius immediately when already inside target and supports pause/resume, cancel, reset, and manual takeover", () => {
    const { world } = buildNavigationWorld();
    world.start();

    // Already inside acceptance radius completes immediately with zero throttle
    const immediate = world.navigateToWaypoint(
      { xMeters: 0.05, zMeters: 0.02 },
      { acceptanceRadiusMeters: 0.15 }
    );
    expect(immediate.status).toBe("completed");
    expect(immediate.isActive).toBe(false);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    // Pause / Resume lifecycle mid-route
    world.navigateWaypoints(
      [
        { xMeters: 0.7, zMeters: 0 },
        { xMeters: 1.4, zMeters: 0 },
      ],
      { acceptanceRadiusMeters: 0.1, timeoutSeconds: 12 }
    );
    for (let i = 0; i < 40; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.getNavigationState().status).toBe("navigating");

    const paused = world.pauseNavigation();
    expect(paused.status).toBe("paused");
    expect(paused.isActive).toBe(false);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    const pausedElapsed = paused.elapsedSeconds;
    const pausedSteps = paused.stepCount;
    for (let i = 0; i < 20; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
    expect(world.getNavigationState().elapsedSeconds).toBe(pausedElapsed);
    expect(world.getNavigationState().stepCount).toBe(pausedSteps);

    const resumed = world.resumeNavigation();
    expect(resumed.status).toBe("navigating");
    expect(resumed.isActive).toBe(true);

    for (let i = 0; i < 420; i++) {
      world.stepFrame(1 / 60);
      if (!world.getNavigationState().isActive) break;
    }
    expect(world.getNavigationState().status).toBe("completed");

    // Explicit cancelNavigation + stopRobot + manual takeover + reset
    world.navigateToWaypoint({ xMeters: 3.0, zMeters: 0 });
    world.stepFrame(1 / 60);
    expect(world.cancelNavigation("Aborted by test").status).toBe("cancelled");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    world.navigateToWaypoint({ xMeters: 3.0, zMeters: 0 });
    world.stepFrame(1 / 60);
    world.stopRobot();
    expect(world.getNavigationState().status).toBe("cancelled");

    world.navigateToWaypoint({ xMeters: 3.0, zMeters: 0 });
    world.stepFrame(1 / 60);
    world.setDriveControls({ forward: true, reverse: false, left: false, right: false });
    expect(world.getNavigationState().status).toBe("cancelled");
    expect(world.getControlState().controlSource).toBe("manual");

    world.navigateToWaypoint({ xMeters: 3.0, zMeters: 0 });
    world.reset();
    expect(world.getNavigationState().status).toBe("idle");
    expect(world.getNavigationState().currentWaypointIndex).toBe(-1);
    expect(world.getNavigationState().waypoints).toHaveLength(0);
  });

  it("handles invalid odometry, empty/invalid waypoints, timeouts, and electrical faults safely", () => {
    // 1. Missing encoders fails cleanly without moving
    const { world: noEncWorld } = buildNavigationWorld({ withEncoders: false });
    noEncWorld.start();
    const blocked = noEncWorld.navigateToWaypoint({ xMeters: 1.0, zMeters: 0 });
    expect(blocked.status).toBe("failed");
    expect(blocked.isActive).toBe(false);
    expect(blocked.failureReason).toBeTruthy();
    expect(noEncWorld.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    // 2. Empty or non-finite waypoint list fails safely
    const { world } = buildNavigationWorld();
    world.start();
    expect(world.navigateWaypoints([]).status).toBe("failed");
    expect(
      world.navigateWaypoints([{ xMeters: Number.NaN, zMeters: 0 }]).status
    ).toBe("failed");

    // 3. Navigation timeout terminates with failed status and zeroes motors
    world.navigateToWaypoint(
      { xMeters: 8.0, zMeters: 0 },
      { maxLinearSpeedMps: 0.4, timeoutSeconds: 0.5 }
    );
    for (let i = 0; i < 60; i++) {
      world.stepFrame(1 / 60);
    }
    const timedOut = world.getNavigationState();
    expect(timedOut.status).toBe("failed");
    expect(timedOut.failureReason).toContain("timed out");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    // 4. Mid-navigation electrical power loss transitions immediately to failed
    const { world: wiredWorld, switchId } = buildNavigationWorld({
      withEncoders: true,
      withSwitchWiring: true,
    });
    wiredWorld.start();
    wiredWorld.navigateToWaypoint({ xMeters: 2.0, zMeters: 0 });
    for (let i = 0; i < 15; i++) {
      wiredWorld.stepFrame(1 / 60);
    }
    expect(wiredWorld.getNavigationState().status).toBe("navigating");

    wiredWorld.setSwitchState(switchId!, false);
    wiredWorld.stepFrame(1 / 60);
    expect(wiredWorld.getNavigationState().status).toBe("failed");
    expect(wiredWorld.getNavigationState().isActive).toBe(false);
    expect(wiredWorld.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("is strictly fixed-timestep deterministic across frame rates (4WD) and integrates with RobotControlRoutine pause/resume lifecycle", () => {
    const runAtFrameRate = (frameDt: number, frameCount: number) => {
      useRobotStore.getState().startNewBuild();
      const { world } = buildNavigationWorld({ drivetrainType: "differential-4" });
      world.start();
      world.navigateWaypoints([
        { xMeters: 0.8, zMeters: 0.4 },
        { xMeters: 1.2, zMeters: 0.0 },
      ]);
      for (let i = 0; i < frameCount; i++) {
        world.stepFrame(frameDt);
      }
      return {
        nav: world.getNavigationState(),
        odo: world.getOdometryState(),
        pose: world.getRenderPose(),
      };
    };

    const fast = runAtFrameRate(1 / 60, 120);
    const coarse = runAtFrameRate(1 / 30, 60);
    expect(fast.pose).toEqual(coarse.pose);
    expect(fast.odo.pose).toEqual(coarse.odo.pose);
    expect(fast.nav.stepCount).toBe(coarse.nav.stepCount);
    expect(fast.nav.currentWaypointIndex).toBe(coarse.nav.currentWaypointIndex);

    // Program routine integration with pauseProgram / resumeProgram
    useRobotStore.getState().startNewBuild();
    const { world: progWorld } = buildNavigationWorld();
    progWorld.setProgramRoutine({
      id: "waypoint-prog",
      name: "Autonomous Waypoint Patrol",
      description: "Navigates 2 waypoints and completes when finished.",
      onStart: (api) => {
        api.navigateWaypoints(
          [
            { xMeters: 0.6, zMeters: 0 },
            { xMeters: 0.6, zMeters: 0.5 },
          ],
          { acceptanceRadiusMeters: 0.12, timeoutSeconds: 12 }
        );
      },
      onTick: (ctx, api) => {
        if (ctx.navigation?.status === "completed") {
          api.completeProgram();
        }
      },
    });

    expect(progWorld.startProgram()).toBe(true);
    for (let i = 0; i < 40; i++) {
      progWorld.stepFrame(1 / 60);
    }
    expect(progWorld.getNavigationState().status).toBe("navigating");

    expect(progWorld.pauseProgram()).toBe(true);
    expect(progWorld.getNavigationState().status).toBe("paused");
    expect(progWorld.resumeProgram()).toBe(true);
    expect(progWorld.getNavigationState().status).toBe("navigating");

    for (let i = 0; i < 600; i++) {
      progWorld.stepFrame(1 / 60);
      if (progWorld.getControlState().programStatus === "completed") break;
    }

    expect(progWorld.getControlState().programStatus).toBe("completed");
    expect(progWorld.getNavigationState().status).toBe("completed");
    expect(
      Math.hypot(
        progWorld.getOdometryState().pose.xMeters - 0.6,
        progWorld.getOdometryState().pose.zMeters - 0.5
      )
    ).toBeLessThanOrEqual(0.13);
  });
});
