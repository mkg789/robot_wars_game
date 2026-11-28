import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import {
  assembleConfiguredRobotFixture,
  wireCommonGroundFixture,
} from "../../../../tests/fixtures/robotFixtures";
import { STANDARD_ROBOT_WARS_ARENA } from "../../simulation/logic/arenaModel";
import { SimulationWorld } from "../../simulation/logic/simulationWorld";

function buildClosedLoopWorld(options?: {
  withEncoders?: boolean;
  withSwitchWiring?: boolean;
  drivetrainType?: "differential-2" | "differential-4";
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
    // Battery -> Power Switch -> ESC Left/Right -> Motors + 5V Buck -> Encoders
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
  }).world!;

  return { world, ids, switchId };
}

describe("Phase 9.4: Closed-Loop Motion Control", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("tracks requested linear and angular velocities using PID feedback from odometry", () => {
    const { world } = buildClosedLoopWorld();
    world.start();

    const started = world.trackVelocity(0.9, 0.35, {
      linearVelocityPid: {
        kp: 0.8,
        ki: 0.3,
        kd: 0.02,
        integralLimits: { min: -0.35, max: 0.35 },
      },
      angularVelocityPid: {
        kp: 0.6,
        ki: 0.3,
        kd: 0.02,
        integralLimits: { min: -0.35, max: 0.35 },
      },
    });
    expect(started.status).toBe("running");
    expect(started.kind).toBe("velocity-hold");

    for (let i = 0; i < 180; i++) {
      world.stepFrame(1 / 60);
    }

    const motion = world.getMotionState();
    const odo = world.getOdometryState();
    expect(motion.status).toBe("running");
    expect(motion.pidStates.linearVelocity.updateCount).toBeGreaterThan(100);
    expect(odo.velocity.linearVelocityMps).toBeCloseTo(0.9, 1);
    expect(odo.velocity.angularVelocityRadPerSec).toBeCloseTo(0.35, 1);
  });

  it("drives to exact positive and negative distances using odometry feedback and settles cleanly within tolerance", () => {
    const { world } = buildClosedLoopWorld();
    world.start();

    const startState = world.driveDistance(1.2, {
      maxLinearSpeedMps: 1.2,
      distanceToleranceMeters: 0.025,
      linearVelocityToleranceMps: 0.08,
      settleStepCount: 3,
      timeoutSeconds: 8,
    });
    expect(startState.status).toBe("running");

    for (let i = 0; i < 360; i++) {
      world.stepFrame(1 / 60);
      if (!world.getMotionState().isActive) break;
    }

    const doneFwd = world.getMotionState();
    expect(doneFwd.status).toBe("completed");
    expect(doneFwd.isActive).toBe(false);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
    expect(world.getOdometryState().pose.xMeters).toBeCloseTo(1.2, 1);
    expect(Math.abs(world.getOdometryState().pose.headingRadians)).toBeLessThan(
      0.03
    );

    // Reverse drive back 0.5m
    world.driveDistance(-0.5, {
      maxLinearSpeedMps: 1.0,
      distanceToleranceMeters: 0.03,
      linearVelocityToleranceMps: 0.08,
      timeoutSeconds: 8,
    });
    for (let i = 0; i < 360; i++) {
      world.stepFrame(1 / 60);
      if (!world.getMotionState().isActive) break;
    }

    expect(world.getMotionState().status).toBe("completed");
    expect(world.getOdometryState().pose.xMeters).toBeCloseTo(0.7, 1);
  });

  it("executes relative turns and absolute heading-target turns including +-pi wrap and >180deg turns", () => {
    const { world } = buildClosedLoopWorld();
    world.start();

    // 1. Relative +90 deg CCW turn
    world.turnByAngle(Math.PI / 2, {
      headingToleranceRadians: 0.03,
      angularVelocityToleranceRadPerSec: 0.1,
      timeoutSeconds: 8,
    });
    for (let i = 0; i < 360; i++) {
      world.stepFrame(1 / 60);
      if (!world.getMotionState().isActive) break;
    }
    expect(world.getMotionState().status).toBe("completed");
    expect(world.getOdometryState().pose.headingRadians).toBeCloseTo(
      Math.PI / 2,
      1
    );

    // 2. Absolute heading target across -3pi/4 (shortest path through +pi/+3pi/4)
    world.turnToHeading(-0.75 * Math.PI, {
      headingToleranceRadians: 0.03,
      angularVelocityToleranceRadPerSec: 0.1,
      timeoutSeconds: 8,
    });
    for (let i = 0; i < 360; i++) {
      world.stepFrame(1 / 60);
      if (!world.getMotionState().isActive) break;
    }
    expect(world.getMotionState().status).toBe("completed");
    expect(world.getOdometryState().pose.headingRadians).toBeCloseTo(
      -0.75 * Math.PI,
      1
    );

    // 3. Large relative turn > 180 deg (+225 deg = +5pi/4) finishes smoothly in requested direction
    world.resetOdometry({ headingRadians: 0 });
    world.turnByAngle(1.25 * Math.PI, {
      headingToleranceRadians: 0.04,
      angularVelocityToleranceRadPerSec: 0.12,
      timeoutSeconds: 10,
    });
    for (let i = 0; i < 480; i++) {
      world.stepFrame(1 / 60);
      if (!world.getMotionState().isActive) break;
    }
    expect(world.getMotionState().status).toBe("completed");
    expect(world.getMotionState().progress.headingDeltaRadians).toBeCloseTo(
      1.25 * Math.PI,
      1
    );
  });

  it("enforces timeouts cleanly and zeroes motor throttles on timeout", () => {
    const { world } = buildClosedLoopWorld();
    world.start();

    world.driveDistance(25.0, {
      maxLinearSpeedMps: 0.5,
      timeoutSeconds: 0.6,
    });
    for (let i = 0; i < 60; i++) {
      world.stepFrame(1 / 60);
    }

    const timedOut = world.getMotionState();
    expect(timedOut.status).toBe("timed-out");
    expect(timedOut.isActive).toBe(false);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("cancels active motion safely on cancelMotion, stopRobot, reset, and manual takeover", () => {
    const { world } = buildClosedLoopWorld();
    world.start();

    // 1. Explicit cancelMotion
    world.driveDistance(3.0);
    world.stepFrame(1 / 60);
    expect(world.getMotionState().isActive).toBe(true);
    const cancelled = world.cancelMotion("User aborted");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.isActive).toBe(false);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    // 2. Manual drive takeover cancels active closed-loop motion immediately
    world.driveDistance(3.0);
    world.stepFrame(1 / 60);
    expect(world.getMotionState().isActive).toBe(true);
    world.setDriveControls({ forward: true, reverse: false, left: false, right: false });
    expect(world.getMotionState().status).toBe("cancelled");
    expect(world.getControlState().controlSource).toBe("manual");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 1, rightThrottle: 1 });

    // 3. stopRobot and reset clear state cleanly
    world.driveDistance(3.0);
    world.stopRobot();
    expect(world.getMotionState().status).toBe("cancelled");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    world.driveDistance(3.0);
    world.reset();
    expect(world.getMotionState().status).toBe("idle");
    expect(world.getMotionState().isActive).toBe(false);
  });

  it("handles electrical failure mid-motion and invalid/missing odometry without driving", () => {
    // 1. Missing encoders / invalid odometry prevents starting closed-loop motion
    const { world: noEncWorld } = buildClosedLoopWorld({ withEncoders: false });
    noEncWorld.start();
    const blocked = noEncWorld.driveDistance(1.0);
    expect(blocked.status).toBe("failed");
    expect(blocked.isActive).toBe(false);
    expect(blocked.failureReason).toBeTruthy();
    expect(noEncWorld.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    // 2. Opening electrical switch mid-motion trips failed state cleanly
    const { world: wiredWorld, switchId } = buildClosedLoopWorld({
      withEncoders: true,
      withSwitchWiring: true,
    });
    wiredWorld.start();
    wiredWorld.driveDistance(2.0);
    for (let i = 0; i < 15; i++) {
      wiredWorld.stepFrame(1 / 60);
    }
    expect(wiredWorld.getMotionState().status).toBe("running");

    wiredWorld.setSwitchState(switchId!, false);
    wiredWorld.stepFrame(1 / 60);
    expect(wiredWorld.getMotionState().status).toBe("failed");
    expect(wiredWorld.getMotionState().isActive).toBe(false);
    expect(wiredWorld.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("is strictly fixed-timestep deterministic and integrates cleanly with RobotControlRoutine", () => {
    const runAtFrameRate = (frameDt: number, frameCount: number) => {
      useRobotStore.getState().startNewBuild();
      const { world } = buildClosedLoopWorld({ drivetrainType: "differential-4" });
      world.start();
      world.driveDistance(0.8);
      for (let i = 0; i < frameCount; i++) {
        world.stepFrame(frameDt);
      }
      return {
        motion: world.getMotionState(),
        odo: world.getOdometryState(),
        pose: world.getRenderPose(),
      };
    };

    // 1/30s (30 frames = 1.0s) vs 1/60s (60 frames = 1.0s) both step 120 identical 1/120s substeps!
    const fastFrames = runAtFrameRate(1 / 60, 60);
    const coarseFrames = runAtFrameRate(1 / 30, 30);
    expect(fastFrames.pose).toEqual(coarseFrames.pose);
    expect(fastFrames.odo.pose).toEqual(coarseFrames.odo.pose);
    expect(fastFrames.motion.stepCount).toBe(coarseFrames.motion.stepCount);

    // RobotControlRoutine multi-step sequential closed-loop program: drive 0.6m then turn 90deg
    useRobotStore.getState().startNewBuild();
    const { world: progWorld } = buildClosedLoopWorld();
    let phase = 0;
    progWorld.setProgramRoutine({
      id: "closed-loop-seq",
      name: "Drive + Turn Closed Loop",
      description: "Drives 0.6m then turns 90 deg left using RobotControlApi primitives.",
      onStart: (api) => {
        phase = 1;
        api.driveDistance(0.6, { timeoutSeconds: 8 });
      },
      onTick: (ctx, api) => {
        if (phase === 1 && ctx.motion?.status === "completed") {
          phase = 2;
          api.turnByAngle(Math.PI / 2, { timeoutSeconds: 8 });
        } else if (phase === 2 && ctx.motion?.status === "completed") {
          phase = 3;
          api.completeProgram();
        }
      },
    });

    expect(progWorld.startProgram()).toBe(true);
    for (let i = 0; i < 600; i++) {
      progWorld.stepFrame(1 / 60);
      if (progWorld.getControlState().programStatus === "completed") break;
    }

    expect(phase).toBe(3);
    expect(progWorld.getControlState().programStatus).toBe("completed");
    expect(progWorld.getOdometryState().pose.xMeters).toBeCloseTo(0.6, 1);
    expect(progWorld.getOdometryState().pose.headingRadians).toBeCloseTo(
      Math.PI / 2,
      1
    );
  });
});
