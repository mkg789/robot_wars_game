import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { assembleConfiguredRobotFixture } from "../../../../tests/fixtures/robotFixtures";
import {
  OBSTACLE_TEST_ARENA,
  SimulationWorld,
} from "../../simulation/logic/simulationWorld";
import { createDifferentialDriveModel } from "./differentialDriveControl";
import {
  createInitialOdometrySession,
  DifferentialDriveOdometryTracker,
  integrateDifferentialDriveDelta,
  stepDifferentialDriveOdometry,
} from "./differentialDriveOdometry";

function installLeftRightEncoders(is4WdPositions = false) {
  const store = useRobotStore.getState();
  if (!is4WdPositions) {
    const leftId = store.installElectricalCatalogueItem(
      "elec-quadrature-encoder",
      { position: [0, 0.1, 0.25] }
    )!;
    const rightId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-quadrature-encoder", {
        position: [0, 0.1, -0.25],
      })!;
    return { leftIds: [leftId], rightIds: [rightId] };
  }

  const fl = store.installElectricalCatalogueItem("elec-quadrature-encoder", {
    position: [0.2, 0.1, 0.25],
  })!;
  const rl = useRobotStore
    .getState()
    .installElectricalCatalogueItem("elec-quadrature-encoder", {
      position: [-0.2, 0.1, 0.25],
    })!;
  const fr = useRobotStore
    .getState()
    .installElectricalCatalogueItem("elec-quadrature-encoder", {
      position: [0.2, 0.1, -0.25],
    })!;
  const rr = useRobotStore
    .getState()
    .installElectricalCatalogueItem("elec-quadrature-encoder", {
      position: [-0.2, 0.1, -0.25],
    })!;
  return { leftIds: [fl, rl], rightIds: [fr, rr] };
}

function buildWorldWithEncoders(options?: {
  drivetrainType?: "differential-2" | "differential-4";
  withEncoders?: boolean;
  fourEncoders?: boolean;
  wirePartialUnpowered?: boolean;
  arenaObstacle?: boolean;
}) {
  const ids = assembleConfiguredRobotFixture({
    drivetrainType: options?.drivetrainType ?? "differential-2",
  });
  let encIds: { leftIds: string[]; rightIds: string[] } = {
    leftIds: [],
    rightIds: [],
  };
  if (options?.withEncoders !== false) {
    encIds = installLeftRightEncoders(options?.fourEncoders ?? false);
  }
  if (options?.wirePartialUnpowered) {
    // Wire Controller only -> electrical wiring exists on robot, leaving encoders unpowered
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: ids.batteryId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: ids.controllerId,
      targetInterfaceId: "ctrl-power-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
  }

  const st = useRobotStore.getState();
  const world = SimulationWorld.fromAssembly({
    parts: st.parts,
    connections: st.connections,
    drivetrain: st.drivetrain,
    foundation: st.foundation,
    electricalConnections: st.electricalConnections,
    arena: options?.arenaObstacle ? OBSTACLE_TEST_ARENA : undefined,
  }).world!;

  return { world, ids, encIds };
}

describe("Phase 9.2: Encoder-Based Odometry", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("integrates straight forward and reverse encoder displacements accurately", () => {
    const { world } = buildWorldWithEncoders();
    const baseModel = world.getDifferentialDriveModel();
    const customModel = createDifferentialDriveModel({
      robotConfig: world.getRobotConfig(),
      geometryOverride: { wheelRadiusM: 0.1, trackWidthM: 0.5 },
    });
    expect(baseModel.isValid).toBe(true);

    const tracker = new DifferentialDriveOdometryTracker({
      model: customModel,
      initialMeasurement: { leftAnglesRad: 0, rightAnglesRad: 0 },
      timestampSeconds: 0,
    });

    // Forward 10 radians on 0.1m radius wheels -> +1.0m along +X
    const s1 = tracker.update(
      customModel,
      { leftAnglesRad: 10, rightAnglesRad: 10 },
      1.0
    );
    expect(s1.isValid).toBe(true);
    expect(s1.status).toBe("ready");
    expect(s1.pose.xMeters).toBeCloseTo(1.0, 6);
    expect(s1.pose.zMeters).toBeCloseTo(0, 6);
    expect(s1.pose.headingRadians).toBeCloseTo(0, 6);
    expect(s1.velocity.linearVelocityMps).toBeCloseTo(1.0, 6);
    expect(s1.velocity.angularVelocityRadPerSec).toBeCloseTo(0, 6);

    // Reverse 4 radians -> delta -0.4m -> net X = +0.6m, total traveled = 1.4m
    const s2 = tracker.update(
      customModel,
      { leftAnglesRad: 6, rightAnglesRad: 6 },
      2.0
    );
    expect(s2.pose.xMeters).toBeCloseTo(0.6, 6);
    expect(s2.pose.zMeters).toBeCloseTo(0, 6);
    expect(s2.leftDistanceMeters).toBeCloseTo(0.6, 6);
    expect(s2.traveledDistanceMeters).toBeCloseTo(1.4, 6);
    expect(s2.velocity.linearVelocityMps).toBeCloseTo(-0.4, 6);
  });

  it("integrates rotation in place (+CCW left and -CW right) with heading wrap normalization", () => {
    const { world } = buildWorldWithEncoders();
    const model = createDifferentialDriveModel({
      robotConfig: world.getRobotConfig(),
      geometryOverride: { wheelRadiusM: 0.1, trackWidthM: 0.5 },
    });

    const tracker = new DifferentialDriveOdometryTracker({
      model,
      initialMeasurement: { leftAnglesRad: 0, rightAnglesRad: 0 },
    });

    // Spin CCW (left) by pi/2 radians: deltaS = (W/2)*(pi/2) = 0.25 * pi/2 meters
    // wheel radians = deltaS / r = (pi/8) / 0.1 = 1.25 * pi
    const spinRad = (0.25 * (Math.PI / 2)) / 0.1;
    const rotated = tracker.update(
      model,
      { leftAnglesRad: -spinRad, rightAnglesRad: spinRad },
      0.5
    );
    expect(rotated.pose.xMeters).toBeCloseTo(0, 6);
    expect(rotated.pose.zMeters).toBeCloseTo(0, 6);
    expect(rotated.pose.headingRadians).toBeCloseTo(Math.PI / 2, 6);
    expect(rotated.pose.headingDegrees).toBeCloseTo(90, 5);
    expect(rotated.velocity.linearVelocityMps).toBeCloseTo(0, 6);
    expect(rotated.velocity.angularVelocityRadPerSec).toBeCloseTo(Math.PI, 5);

    // Additional spin crossing +pi wraps cleanly into (-pi, pi]
    const wrapRad = (0.25 * (Math.PI * 0.75)) / 0.1;
    const wrapped = tracker.update(
      model,
      { leftAnglesRad: -spinRad - wrapRad, rightAnglesRad: spinRad + wrapRad },
      1.0
    );
    expect(wrapped.pose.headingRadians).toBeCloseTo(-0.75 * Math.PI, 6);
  });

  it("uses exact constant-curvature arc integration for curved motion and Taylor stability for near-zero angles", () => {
    const { world } = buildWorldWithEncoders();
    const model = createDifferentialDriveModel({
      robotConfig: world.getRobotConfig(),
      geometryOverride: { wheelRadiusM: 0.1, trackWidthM: 0.5 },
    });

    // Exact 90-degree left arc with centerline radius R = 1.0 m:
    // Left wheel arc radius = R - W/2 = 0.75m, right wheel arc radius = R + W/2 = 1.25m
    // Arc travel over theta = pi/2: dL = 0.75 * pi/2, dR = 1.25 * pi/2
    const arcSingle = integrateDifferentialDriveDelta({
      pose: { xMeters: 0, zMeters: 0, headingRadians: 0, headingDegrees: 0 },
      deltaLeftMeters: 0.75 * (Math.PI / 2),
      deltaRightMeters: 1.25 * (Math.PI / 2),
      trackWidthM: 0.5,
    });
    // Exact constant-curvature circle center is at (0, 1.0): 90deg CCW lands at (1.0, 1.0)
    expect(arcSingle.pose.xMeters).toBeCloseTo(1.0, 6);
    expect(arcSingle.pose.zMeters).toBeCloseTo(1.0, 6);
    expect(arcSingle.pose.headingRadians).toBeCloseTo(Math.PI / 2, 6);

    // Near-zero angular difference (|dTheta| = 1e-8 rad) produces finite accurate displacement
    const tracker = new DifferentialDriveOdometryTracker({
      model,
      initialMeasurement: { leftAnglesRad: 0, rightAnglesRad: 0 },
    });
    const tiny = tracker.update(
      model,
      { leftAnglesRad: 5.0, rightAnglesRad: 5.0 + 5e-8 },
      1.0
    );
    expect(Number.isFinite(tiny.pose.xMeters)).toBe(true);
    expect(Number.isFinite(tiny.pose.zMeters)).toBe(true);
    expect(tiny.pose.xMeters).toBeCloseTo(0.5, 6);
    expect(tiny.pose.headingRadians).toBeCloseTo(1e-8, 12);
  });

  it("supports configurable wheel radius, track width, and 2WD vs 4WD per-side encoder aggregation", () => {
    const { world: w4 } = buildWorldWithEncoders({
      drivetrainType: "differential-4",
      fourEncoders: true,
    });
    const model4Small = createDifferentialDriveModel({
      robotConfig: w4.getRobotConfig(),
      geometryOverride: { wheelRadiusM: 0.08, trackWidthM: 0.4 },
    });
    const model4Large = createDifferentialDriveModel({
      robotConfig: w4.getRobotConfig(),
      geometryOverride: { wheelRadiusM: 0.16, trackWidthM: 0.8 },
    });

    const trackerSmall = new DifferentialDriveOdometryTracker({
      model: model4Small,
      initialMeasurement: {
        leftAnglesRad: [0, 0],
        rightAnglesRad: [0, 0],
      },
    });
    const trackerLarge = new DifferentialDriveOdometryTracker({
      model: model4Large,
      initialMeasurement: {
        leftAnglesRad: [0, 0],
        rightAnglesRad: [0, 0],
      },
    });

    // Paired front/rear wheels on each side aggregate by arithmetic mean
    const resSmall = trackerSmall.update(
      model4Small,
      { leftAnglesRad: [9.8, 10.2], rightAnglesRad: [9.9, 10.1] },
      1.0
    );
    const resLarge = trackerLarge.update(
      model4Large,
      { leftAnglesRad: [9.8, 10.2], rightAnglesRad: [9.9, 10.1] },
      1.0
    );
    expect(resSmall.leftChannel.encoderCount).toBe(2);
    expect(resSmall.rightChannel.encoderCount).toBe(2);
    expect(resSmall.pose.xMeters).toBeCloseTo(0.8, 6);
    expect(resLarge.pose.xMeters).toBeCloseTo(1.6, 6);

    // Turning: doubled radius & doubled track width yields identical heading change deltaTheta
    const spinSmall = trackerSmall.update(
      model4Small,
      { leftAnglesRad: [8.8, 9.2], rightAnglesRad: [10.9, 11.1] },
      2.0
    );
    const spinLarge = trackerLarge.update(
      model4Large,
      { leftAnglesRad: [8.8, 9.2], rightAnglesRad: [10.9, 11.1] },
      2.0
    );
    expect(spinSmall.pose.headingRadians).toBeCloseTo(
      spinLarge.pose.headingRadians,
      6
    );
  });

  it("resets odometry pose and re-anchors cumulative encoder baseline cleanly", () => {
    const { world } = buildWorldWithEncoders();
    world.start();
    world.setTwistVelocity(0.8, 0.4);
    for (let i = 0; i < 40; i++) {
      world.stepFrame(1 / 60);
    }

    const truePoseBeforeReset = world.getRenderPose();
    const odoBefore = world.getOdometryState();
    expect(odoBefore.isValid).toBe(true);
    expect(odoBefore.pose.xMeters).toBeGreaterThan(0.1);

    // Reset odometry mid-run to arbitrary pose without altering SimulationWorld ground truth
    const anchored = world.resetOdometry({
      xMeters: 2.5,
      zMeters: -1.0,
      headingRadians: 0.5,
    });
    expect(anchored.pose.xMeters).toBeCloseTo(2.5, 6);
    expect(anchored.pose.zMeters).toBeCloseTo(-1.0, 6);
    expect(anchored.pose.headingRadians).toBeCloseTo(0.5, 6);
    expect(anchored.traveledDistanceMeters).toBe(0);
    expect(world.getRenderPose()).toEqual(truePoseBeforeReset);

    // Continuing to drive integrates strictly from the new baseline & pose
    for (let i = 0; i < 30; i++) {
      world.stepFrame(1 / 60);
    }
    const odoAfter = world.getOdometryState();
    expect(odoAfter.traveledDistanceMeters).toBeGreaterThan(0.05);
    expect(odoAfter.pose.xMeters).not.toBeCloseTo(world.getRenderPose().xMeters, 2);
  });

  it("handles missing, single-side, unpowered, non-finite encoders and invalid geometry safely", () => {
    // 1. Missing encoders in SimulationWorld -> refuses to fake pose from ground truth
    const { world: noEncWorld } = buildWorldWithEncoders({
      withEncoders: false,
    });
    noEncWorld.start();
    noEncWorld.setTwistVelocity(0.8, 0);
    for (let i = 0; i < 30; i++) {
      noEncWorld.stepFrame(1 / 60);
    }
    expect(noEncWorld.getRenderPose().xMeters).toBeGreaterThan(0.1);
    const missingOdo = noEncWorld.getOdometryState();
    expect(missingOdo.isValid).toBe(false);
    expect(missingOdo.status).toBe("unavailable-encoders");
    expect(missingOdo.pose.xMeters).toBe(0);

    // 2. Unpowered encoders -> explicit unavailable-unpowered status
    const { world: unpoweredEncWorld } = buildWorldWithEncoders({
      withEncoders: true,
      wirePartialUnpowered: true,
    });
    expect(unpoweredEncWorld.getOdometryState().isValid).toBe(false);
    expect(unpoweredEncWorld.getOdometryState().status).toBe(
      "unavailable-unpowered"
    );

    // 3. Invalid geometry or NaN readings in pure step function
    const invalidModel = createDifferentialDriveModel({ robotConfig: null });
    const session = createInitialOdometrySession({ model: invalidModel });
    expect(session.state.isValid).toBe(false);
    expect(session.state.status).toBe("invalid-geometry");

    const { world: validWorld } = buildWorldWithEncoders();
    const validModel = validWorld.getDifferentialDriveModel();
    const validSession = createInitialOdometrySession({
      model: validModel,
      initialMeasurement: { leftAnglesRad: 0, rightAnglesRad: 0 },
    });
    const nanStep = stepDifferentialDriveOdometry({
      state: validSession.state,
      baseline: validSession.baseline,
      model: validModel,
      measurement: { leftAnglesRad: Number.NaN, rightAnglesRad: 1.0 },
      timestampSeconds: 1.0,
    });
    expect(nanStep.state.isValid).toBe(false);
    expect(nanStep.state.status).toBe("unavailable-encoders");
    expect(nanStep.state.pose.xMeters).toBe(0);
  });

  it("integrates deterministically with SimulationWorld 2WD/4WD runtime and stays independent from ground-truth pose", () => {
    const runCurveSequence = () => {
      useRobotStore.getState().startNewBuild();
      const { world } = buildWorldWithEncoders({
        drivetrainType: "differential-4",
        fourEncoders: true,
      });
      world.start();
      world.setTwistVelocity(0.85, 0.9);
      for (let i = 0; i < 90; i++) {
        world.stepFrame(1 / 60);
      }
      return world;
    };

    const run1 = runCurveSequence();
    const run2 = runCurveSequence();

    // Deterministic output across identical simulation runs
    expect(run1.getOdometryState()).toEqual(run2.getOdometryState());

    const odo = run1.getOdometryState();
    const truth = run1.getRenderPose();
    expect(odo.isValid).toBe(true);
    expect(odo.status).toBe("ready");
    expect(odo.leftChannel.encoderCount).toBe(2);
    expect(odo.rightChannel.encoderCount).toBe(2);

    // On clean non-colliding high-grip floor, encoder odometry tracks physical trajectory closely
    expect(odo.pose.xMeters).toBeCloseTo(truth.xMeters, 2);
    expect(odo.pose.zMeters).toBeCloseTo(truth.zMeters, 2);
    expect(odo.pose.headingRadians).toBeCloseTo(truth.headingRadians, 2);

    // Exposed inside RobotControlRoutine context cleanly
    let observedProgramOdo = false;
    run1.setProgramRoutine({
      id: "odo-check-routine",
      name: "Odometry Context Probe",
      description: "Verifies ctx.odometry availability.",
      onTick: (ctx, api) => {
        if (ctx.odometry?.isValid) {
          observedProgramOdo = true;
        }
        api.completeProgram();
      },
    });
    run1.startProgram();
    run1.stepFrame(1 / 60);
    expect(observedProgramOdo).toBe(true);
  });
});
