import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { assembleConfiguredRobotFixture } from "../../../../tests/fixtures/robotFixtures";
import type { SimulationRobotConfig } from "../../simulation/types/simulation.types";
import { SimulationWorld } from "../../simulation/logic/simulationWorld";
import {
  computeChassisTwistFromWheelVelocities,
  computeDifferentialDriveTargetsFromNormalizedVelocity,
  computeDifferentialDriveTargetsFromTwist,
  createDifferentialDriveModel,
} from "./differentialDriveControl";

function createTestWorld(options?: {
  drivetrainType?: "differential-2" | "differential-4";
  wireEscAndMotors?: boolean;
}) {
  const ids = assembleConfiguredRobotFixture({
    drivetrainType: options?.drivetrainType ?? "differential-2",
    wireEscAndMotors: options?.wireEscAndMotors ?? false,
  });
  const st = useRobotStore.getState();
  const world = SimulationWorld.fromAssembly({
    parts: st.parts,
    connections: st.connections,
    drivetrain: st.drivetrain,
    foundation: st.foundation,
    electricalConnections: st.electricalConnections,
  }).world!;
  return { world, ids };
}

describe("Phase 9.1: Differential-Drive Control", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("computes accurate inverse/forward kinematics for forward and reverse movement", () => {
    const { world } = createTestWorld();
    const model = world.getDifferentialDriveModel();
    expect(model.isValid).toBe(true);
    expect(model.drivetrainType).toBe("differential-2");
    expect(model.left.wheelCount).toBe(1);
    expect(model.right.wheelCount).toBe(1);

    const forwardRes = computeDifferentialDriveTargetsFromTwist({
      model,
      command: { linearVelocityMps: 0.8, angularVelocityRadPerSec: 0 },
      robotConfig: world.getRobotConfig(),
    });
    expect(forwardRes.accepted).toBe(true);
    expect(forwardRes.saturated).toBe(false);
    expect(forwardRes.leftWheelAngularVelocityRadPerSec).toBeCloseTo(
      0.8 / model.left.effectiveWheelRadiusM,
      6
    );
    expect(forwardRes.rightWheelAngularVelocityRadPerSec).toBeCloseTo(
      0.8 / model.right.effectiveWheelRadiusM,
      6
    );
    expect(forwardRes.leftThrottle).toBeCloseTo(forwardRes.rightThrottle, 6);
    expect(forwardRes.leftThrottle).toBeGreaterThan(0);

    const reverseRes = computeDifferentialDriveTargetsFromTwist({
      model,
      command: { linearVelocityMps: -0.6, angularVelocityRadPerSec: 0 },
      robotConfig: world.getRobotConfig(),
    });
    expect(reverseRes.accepted).toBe(true);
    expect(reverseRes.leftWheelAngularVelocityRadPerSec).toBeCloseTo(
      -0.6 / model.left.effectiveWheelRadiusM,
      6
    );
    expect(reverseRes.leftThrottle).toBeLessThan(0);
    expect(reverseRes.rightThrottle).toBeCloseTo(reverseRes.leftThrottle, 6);

    const forwardFk = computeChassisTwistFromWheelVelocities(
      model,
      forwardRes.leftWheelAngularVelocityRadPerSec,
      forwardRes.rightWheelAngularVelocityRadPerSec
    );
    expect(forwardFk.linearVelocityMps).toBeCloseTo(0.8, 6);
    expect(forwardFk.angularVelocityRadPerSec).toBeCloseTo(0, 6);
  });

  it("drives forward (+X) and reverse (-X) deterministically through SimulationWorld physics", () => {
    const { world: wFwd1 } = createTestWorld();
    wFwd1.start();
    const resFwd = wFwd1.setTwistVelocity(0.9, 0);
    expect(resFwd.accepted).toBe(true);
    for (let i = 0; i < 60; i++) {
      wFwd1.stepFrame(1 / 60);
    }
    const poseFwd1 = wFwd1.getRenderPose();
    expect(poseFwd1.xMeters).toBeGreaterThan(0.2);
    expect(Math.abs(poseFwd1.headingRadians)).toBeLessThan(0.01);

    // Determinism check: identical world & commands produce bit-identical state
    const { world: wFwd2 } = createTestWorld();
    wFwd2.start();
    wFwd2.setTwistVelocity(0.9, 0);
    for (let i = 0; i < 60; i++) {
      wFwd2.stepFrame(1 / 60);
    }
    expect(wFwd2.getRenderPose()).toEqual(poseFwd1);

    // Reverse velocity moves toward -X cleanly
    const { world: wRev } = createTestWorld();
    wRev.start();
    wRev.setTwistVelocity(-0.9, 0);
    for (let i = 0; i < 60; i++) {
      wRev.stepFrame(1 / 60);
    }
    const poseRev = wRev.getRenderPose();
    expect(poseRev.xMeters).toBeLessThan(-0.2);
    expect(Math.abs(poseRev.headingRadians)).toBeLessThan(0.01);
  });

  it("handles rotation in place and combined linear + angular movement with exact arc kinematics", () => {
    const { world } = createTestWorld();
    const model = world.getDifferentialDriveModel();

    // Positive omega rotates CCW (+Y / turn left): right wheel faster forward than left wheel
    const spinLeft = computeDifferentialDriveTargetsFromTwist({
      model,
      command: { linearVelocityMps: 0, angularVelocityRadPerSec: 1.5 },
      robotConfig: world.getRobotConfig(),
    });
    expect(spinLeft.accepted).toBe(true);
    expect(spinLeft.leftWheelLinearVelocityMps).toBeCloseTo(
      -(model.trackWidthM / 2) * 1.5,
      6
    );
    expect(spinLeft.rightWheelLinearVelocityMps).toBeCloseTo(
      (model.trackWidthM / 2) * 1.5,
      6
    );
    expect(spinLeft.leftThrottle).toBeCloseTo(-spinLeft.rightThrottle, 6);

    world.start();
    world.setTwistVelocity(0, 1.5);
    for (let i = 0; i < 60; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.getRenderPose().headingRadians).toBeGreaterThan(0.2);
    expect(Math.abs(world.getRenderPose().xMeters)).toBeLessThan(0.05);

    // Combined linear + angular movement drives an arc turning right for negative omega
    world.reset();
    world.start();
    const arcRes = world.setTwistVelocity(0.7, -0.8);
    expect(arcRes.rightWheelAngularVelocityRadPerSec).toBeLessThan(
      arcRes.leftWheelAngularVelocityRadPerSec
    );
    const fk = computeChassisTwistFromWheelVelocities(
      model,
      arcRes.leftWheelAngularVelocityRadPerSec,
      arcRes.rightWheelAngularVelocityRadPerSec
    );
    expect(fk.linearVelocityMps).toBeCloseTo(arcRes.achievedLinearVelocityMps, 6);
    expect(fk.angularVelocityRadPerSec).toBeCloseTo(
      arcRes.achievedAngularVelocityRadPerSec,
      6
    );

    for (let i = 0; i < 60; i++) {
      world.stepFrame(1 / 60);
    }
    const arcPose = world.getRenderPose();
    expect(arcPose.xMeters).toBeGreaterThan(0.1);
    expect(arcPose.headingRadians).toBeLessThan(-0.1);
  });

  it("supports configurable wheel radius and track width plus 4WD wheel-pair aggregation", () => {
    const { world: world4wd } = createTestWorld({
      drivetrainType: "differential-4",
    });
    const config4wd = world4wd.getRobotConfig();
    const model4wd = world4wd.getDifferentialDriveModel();

    expect(model4wd.isValid).toBe(true);
    expect(model4wd.drivetrainType).toBe("differential-4");
    expect(model4wd.left.wheelCount).toBe(2);
    expect(model4wd.right.wheelCount).toBe(2);
    expect(model4wd.left.motorIds).toHaveLength(2);
    expect(model4wd.right.motorIds).toHaveLength(2);

    const twistRes = world4wd.setTwistVelocity(0.6, 0.5);
    expect(twistRes.wheelTargets).toHaveLength(4);
    const leftTargets = twistRes.wheelTargets.filter((t) => t.side === "left");
    const rightTargets = twistRes.wheelTargets.filter((t) => t.side === "right");
    expect(leftTargets).toHaveLength(2);
    expect(rightTargets).toHaveLength(2);
    expect(leftTargets[0].targetAngularVelocityRadPerSec).toBeCloseTo(
      leftTargets[1].targetAngularVelocityRadPerSec,
      6
    );

    // Configurable wheel radius & track width override
    const doubledRadiusModel = createDifferentialDriveModel({
      robotConfig: config4wd,
      geometryOverride: {
        wheelRadiusM: model4wd.left.effectiveWheelRadiusM * 2,
        trackWidthM: model4wd.trackWidthM * 1.5,
      },
    });
    const baseStraight = computeDifferentialDriveTargetsFromTwist({
      model: model4wd,
      command: { linearVelocityMps: 0.6, angularVelocityRadPerSec: 0 },
    });
    const wideFastStraight = computeDifferentialDriveTargetsFromTwist({
      model: doubledRadiusModel,
      command: { linearVelocityMps: 0.6, angularVelocityRadPerSec: 0 },
    });
    expect(wideFastStraight.leftWheelAngularVelocityRadPerSec).toBeCloseTo(
      baseStraight.leftWheelAngularVelocityRadPerSec / 2,
      6
    );

    const spinWide = computeDifferentialDriveTargetsFromTwist({
      model: doubledRadiusModel,
      command: { linearVelocityMps: 0, angularVelocityRadPerSec: 1.0 },
    });
    expect(spinWide.rightWheelLinearVelocityMps).toBeCloseTo(
      (model4wd.trackWidthM * 1.5 * 0.5) * 1.0,
      6
    );
  });

  it("saturates over-limit commands cleanly while preserving intended linear-to-angular motion ratio", () => {
    const { world } = createTestWorld();
    const model = world.getDifferentialDriveModel();

    const reqLinear = model.maxLinearVelocityMps * 3.0;
    const reqAngular = model.maxAngularVelocityRadPerSec * 1.5;
    const saturatedRes = computeDifferentialDriveTargetsFromTwist({
      model,
      command: {
        linearVelocityMps: reqLinear,
        angularVelocityRadPerSec: reqAngular,
      },
      robotConfig: world.getRobotConfig(),
    });

    expect(saturatedRes.accepted).toBe(true);
    expect(saturatedRes.saturated).toBe(true);
    expect(saturatedRes.saturationScale).toBeGreaterThan(0);
    expect(saturatedRes.saturationScale).toBeLessThan(1);
    expect(
      Math.abs(saturatedRes.leftWheelAngularVelocityRadPerSec)
    ).toBeLessThanOrEqual(model.left.maxWheelAngularVelocityRadPerSec + 1e-6);
    expect(
      Math.abs(saturatedRes.rightWheelAngularVelocityRadPerSec)
    ).toBeLessThanOrEqual(model.right.maxWheelAngularVelocityRadPerSec + 1e-6);
    expect(Math.abs(saturatedRes.leftThrottle)).toBeLessThanOrEqual(1);
    expect(Math.abs(saturatedRes.rightThrottle)).toBeLessThanOrEqual(1);

    // Curvature ratio omega / v must be preserved identically across saturation
    expect(
      saturatedRes.achievedAngularVelocityRadPerSec /
        saturatedRes.achievedLinearVelocityMps
    ).toBeCloseTo(reqAngular / reqLinear, 6);

    // Normalized control API saturates & clamps out-of-range inputs safely
    const normOverRes = computeDifferentialDriveTargetsFromNormalizedVelocity({
      model,
      command: { linear: 1.4, angular: 0.8 },
    });
    expect(normOverRes.clampedNormalizedInput).toBe(true);
    expect(normOverRes.saturated).toBe(true);
    expect(Math.abs(normOverRes.leftThrottle)).toBeLessThanOrEqual(1);
    expect(Math.abs(normOverRes.rightThrottle)).toBeLessThanOrEqual(1);
    expect(
      normOverRes.achievedAngularVelocityRadPerSec /
        normOverRes.achievedLinearVelocityMps
    ).toBeCloseTo(
      (0.8 * model.maxAngularVelocityRadPerSec) /
        (1.0 * model.maxLinearVelocityMps),
      6
    );
  });

  it("enforces electrical limits and blocks driving when motor branch is unpowered without bypassing physics", () => {
    const { world, ids } = createTestWorld({ wireEscAndMotors: true });
    expect(world.getDifferentialDriveModel().isValid).toBe(true);
    expect(world.getDifferentialDriveModel().left.isDrivable).toBe(true);

    // Remove power wire to left motor -> compile-time / runtime unpowered branch
    const leftPowerConn = useRobotStore
      .getState()
      .electricalConnections.find(
        (c) =>
          (c.targetPartId === ids.leftMotorId ||
            c.sourcePartId === ids.leftMotorId) &&
          c.connectionType === "power"
      );
    expect(leftPowerConn).toBeDefined();
    useRobotStore.getState().removeElectricalConnection(leftPowerConn!.id);

    const stFault = useRobotStore.getState();
    const faultWorld = SimulationWorld.fromAssembly({
      parts: stFault.parts,
      connections: stFault.connections,
      drivetrain: stFault.drivetrain,
      foundation: stFault.foundation,
      electricalConnections: stFault.electricalConnections,
    }).world!;

    const degradedModel = faultWorld.getDifferentialDriveModel();
    expect(degradedModel.left.isDrivable).toBe(false);
    expect(degradedModel.left.maxWheelAngularVelocityRadPerSec).toBe(0);
    expect(degradedModel.right.isDrivable).toBe(true);

    // Commanding straight forward safely halts rather than spinning uncontrollably around dead left side
    faultWorld.start();
    const straightAttempt = faultWorld.setTwistVelocity(0.5, 0);
    expect(straightAttempt.leftThrottle).toBe(0);
    expect(straightAttempt.rightThrottle).toBe(0);
    expect(straightAttempt.saturated).toBe(true);
  });

  it("handles missing, invalid, or unsupported drivetrain configurations and non-finite inputs safely", () => {
    const nullModel = createDifferentialDriveModel({ robotConfig: null });
    expect(nullModel.isValid).toBe(false);
    expect(nullModel.errors.length).toBeGreaterThan(0);

    const { world } = createTestWorld();
    const baseConfig = world.getRobotConfig();

    const unsupportedConfig = {
      ...baseConfig,
      drivetrain: {
        ...baseConfig.drivetrain,
        type: "mecanum-4" as unknown as SimulationRobotConfig["drivetrain"]["type"],
      },
    };
    const unsupportedModel = createDifferentialDriveModel({
      robotConfig: unsupportedConfig,
    });
    expect(unsupportedModel.isValid).toBe(false);

    const badTrackModel = createDifferentialDriveModel({
      robotConfig: { ...baseConfig, trackWidthM: 0 },
    });
    expect(badTrackModel.isValid).toBe(false);

    const zeroRes = computeDifferentialDriveTargetsFromTwist({
      model: unsupportedModel,
      command: { linearVelocityMps: 1.0, angularVelocityRadPerSec: 0.2 },
    });
    expect(zeroRes.accepted).toBe(false);
    expect(zeroRes.leftThrottle).toBe(0);
    expect(zeroRes.rightThrottle).toBe(0);

    const nanRes = world.setTwistVelocity(Number.NaN, Number.POSITIVE_INFINITY);
    expect(nanRes.accepted).toBe(false);
    expect(nanRes.leftThrottle).toBe(0);
    expect(nanRes.rightThrottle).toBe(0);
  });

  it("integrates with RobotControlRoutine and preserves manual controls cleanly", () => {
    const { world } = createTestWorld();
    const model = world.getDifferentialDriveModel();

    world.setProgramRoutine({
      id: "twist-routine",
      name: "Velocity Twist Program",
      description: "Commands normalized and physical twist velocities cleanly.",
      onTick: (ctx, api) => {
        if (ctx.timeSeconds < 0.25) {
          api.setNormalizedVelocity(0.6, 0.25);
        } else {
          api.completeProgram();
        }
      },
    });
    expect(world.startProgram()).toBe(true);
    for (let i = 0; i < 20; i++) {
      world.stepFrame(1 / 60);
    }
    const poseAfterAuto = world.getRenderPose();
    expect(poseAfterAuto.xMeters).toBeGreaterThan(0.02);
    expect(poseAfterAuto.headingRadians).toBeGreaterThan(0.01);
    expect(model.isValid).toBe(true);

    // Manual takeover continues working normally after velocity-based program
    world.setDriveControls({ forward: true, reverse: false, left: false, right: false });
    expect(world.getControlState().controlSource).toBe("manual");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 1, rightThrottle: 1 });
  });
});
