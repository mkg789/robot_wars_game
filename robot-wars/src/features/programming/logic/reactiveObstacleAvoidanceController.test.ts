import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import {
  assembleConfiguredRobotFixture,
  wireCommonGroundFixture,
} from "../../../../tests/fixtures/robotFixtures";
import { createRectangularArena } from "../../simulation/logic/arenaModel";
import type { ArenaBarrier } from "../../simulation/types/arena.types";
import { SimulationWorld } from "../../simulation/logic/simulationWorld";
import type {
  DifferentialDriveOdometryState,
  DistanceSensorObservation,
} from "../types/control.types";
import { ReactiveObstacleAvoidanceController } from "./reactiveObstacleAvoidanceController";

function makeBarrier(params: {
  id: string;
  name: string;
  position: { x: number; z: number };
  sizeX: number;
  sizeZ: number;
  heightM: number;
}): ArenaBarrier {
  return {
    id: params.id,
    name: params.name,
    geometryType: "rectangle",
    position: params.position,
    sizeX: params.sizeX,
    sizeZ: params.sizeZ,
    heightM: params.heightM,
  };
}

function buildAvoidanceWorld(options?: {
  sensors?: ReadonlyArray<{
    catalogueId: "elec-hcsr04-ultrasonic" | "elec-vl53l0x-tof";
    position: [number, number, number];
    rotation?: [number, number, number];
  }>;
  barriers?: readonly ArenaBarrier[];
  withFullPowerWiring?: boolean;
  leaveSensorsUnpowered?: boolean;
  drivetrainType?: "differential-2" | "differential-4";
}) {
  const ids = assembleConfiguredRobotFixture({
    drivetrainType: options?.drivetrainType ?? "differential-2",
  });

  useRobotStore.getState().installElectricalCatalogueItem(
    "elec-quadrature-encoder",
    { position: [0, 0.1, 0.25] }
  );
  useRobotStore.getState().installElectricalCatalogueItem(
    "elec-quadrature-encoder",
    { position: [0, 0.1, -0.25] }
  );

  const sensorIds: string[] = [];
  for (const sensorSpec of options?.sensors ?? [
    {
      catalogueId: "elec-hcsr04-ultrasonic",
      position: [1.28, 0.15, 0],
    },
  ]) {
    const id = useRobotStore
      .getState()
      .installElectricalCatalogueItem(sensorSpec.catalogueId, {
        position: sensorSpec.position,
      })!;
    if (sensorSpec.rotation) {
      useRobotStore
        .getState()
        .updatePartTransform(id, sensorSpec.position, sensorSpec.rotation);
    }
    sensorIds.push(id);
  }

  let switchId: string | null = null;
  if (options?.withFullPowerWiring || options?.leaveSensorsUnpowered) {
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
    if (!options?.leaveSensorsUnpowered) {
      for (const sId of sensorIds) {
        const part = useRobotStore.getState().parts.find((p) => p.id === sId)!;
        addConn({
          sourcePartId: buckId,
          sourceInterfaceId: "elec-buck-5v-pwr-out",
          targetPartId: sId,
          targetInterfaceId: `${part.electricalCatalogueId}-pwr-in`,
          connectionType: "power",
          provenance: { method: "user-supplied" },
        });
      }
    }
    wireCommonGroundFixture(
      [
        escLeftId,
        escRightId,
        buckId,
        ids.controllerId,
        ...encoders.map((e) => e.id),
        ...(options?.leaveSensorsUnpowered ? [] : sensorIds),
      ],
      ids.batteryId
    );
  }

  const arena = createRectangularArena({
    id: "avoidance-test-arena",
    name: "Avoidance Test Arena (18m x 18m)",
    lengthM: 18.0,
    widthM: 18.0,
    barriers: [...(options?.barriers ?? [])],
  });

  const st = useRobotStore.getState();
  const world = SimulationWorld.fromAssembly({
    parts: st.parts,
    connections: st.connections,
    drivetrain: st.drivetrain,
    foundation: st.foundation,
    electricalConnections: st.electricalConnections,
    arena,
  }).world!;

  return { world, ids, sensorIds, switchId };
}

function makeSyntheticObservation(params: {
  sensorId: string;
  sensorKind?: "ultrasonic" | "tof-distance";
  distanceMeters: number | null;
  zOffset?: number;
  yaw?: number;
  status?: "ready" | "unavailable-unpowered" | "unavailable-electrical-fault";
}): DistanceSensorObservation {
  const ready = (params.status ?? "ready") === "ready";
  return {
    sensorId: params.sensorId,
    sensorName: params.sensorId,
    sensorKind: params.sensorKind ?? "ultrasonic",
    localMountOffset: { x: 0.35, y: 0.15, z: params.zOffset ?? 0 },
    mountYawOffsetRadians: params.yaw ?? 0,
    reading: ready
      ? {
          ok: true,
          status: "ready",
          sensorId: params.sensorId,
          sensorName: params.sensorId,
          sensorKind: params.sensorKind ?? "ultrasonic",
          timestampSeconds: 1,
          assumptions: [],
          data: {
            distanceMeters: params.distanceMeters ?? 4.0,
            distanceCm: (params.distanceMeters ?? 4.0) * 100,
            inRange: params.distanceMeters !== null,
            minRangeMeters: 0.02,
            maxRangeMeters: 4.0,
            hitBarrierId: params.distanceMeters !== null ? "obs" : null,
          },
        }
      : {
          ok: false,
          status: params.status!,
          sensorId: params.sensorId,
          sensorName: params.sensorId,
          sensorKind: params.sensorKind ?? "ultrasonic",
          timestampSeconds: 1,
          reason: `Simulated ${params.status}`,
          assumptions: [],
          data: null,
        },
  };
}

function makeReadyOdometry(params?: {
  x?: number;
  heading?: number;
  traveled?: number;
}): DifferentialDriveOdometryState {
  return {
    status: "ready",
    isValid: true,
    timestampSeconds: 0,
    pose: {
      xMeters: params?.x ?? 0,
      zMeters: 0,
      headingRadians: params?.heading ?? 0,
      headingDegrees: ((params?.heading ?? 0) * 180) / Math.PI,
    },
    velocity: {
      linearVelocityMps: 0,
      angularVelocityRadPerSec: 0,
    },
    leftChannel: {
      encoderCount: 1,
      readyCount: 1,
      cumulativeRadians: 0,
    },
    rightChannel: {
      encoderCount: 1,
      readyCount: 1,
      cumulativeRadians: 0,
    },
    leftDistanceMeters: params?.traveled ?? 0,
    rightDistanceMeters: params?.traveled ?? 0,
    traveledDistanceMeters: params?.traveled ?? 0,
    lastStep: {
      leftRadians: 0,
      rightRadians: 0,
      leftMeters: 0,
      rightMeters: 0,
      linearMeters: 0,
      angularRadians: 0,
      dtSeconds: 1 / 120,
    },
    updateCount: 1,
    warnings: [],
  };
}

describe("Phase 9.6: Reactive Obstacle Avoidance", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("navigates cleanly on a clear path using ultrasonic or ToF distance sensors without unneeded maneuvers", () => {
    const { world } = buildAvoidanceWorld({
      sensors: [{ catalogueId: "elec-vl53l0x-tof", position: [1.28, 0.15, 0] }],
    });
    world.start();

    const started = world.navigateToWaypoint(
      { xMeters: 1.4, zMeters: 0 },
      { acceptanceRadiusMeters: 0.12, timeoutSeconds: 12 }
    );
    expect(started.status).toBe("navigating");
    expect(world.getObstacleAvoidanceState().enabled).toBe(true);
    expect(world.getObstacleAvoidanceState().status).toBe("clear");
    expect(world.getObstacleAvoidanceState().sensorStatus).toBe("ready");

    for (let i = 0; i < 420; i++) {
      world.stepFrame(1 / 60);
      if (!world.getNavigationState().isActive) break;
    }

    expect(world.getNavigationState().status).toBe("completed");
    expect(world.getObstacleAvoidanceState().attemptCount).toBe(0);
    expect(world.getObstacleAvoidanceState().isActive).toBe(false);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("slows down proportionally in the slowdown zone and halts at the safety zone before turning", () => {
    const obstacle = makeBarrier({
      id: "front-block",
      name: "Front Block",
      position: { x: 3.1, z: 0 },
      sizeX: 0.4,
      sizeZ: 0.6,
      heightM: 0.8,
    });
    const { world } = buildAvoidanceWorld({
      sensors: [{ catalogueId: "elec-hcsr04-ultrasonic", position: [1.28, 0.15, 0] }],
      barriers: [obstacle],
    });
    world.start();

    world.navigateToWaypoint(
      { xMeters: 4.5, zMeters: 0 },
      {
        maxLinearSpeedMps: 0.9,
        obstacleAvoidance: {
          enabled: true,
          detectionDistanceMeters: 1.8,
          slowdownDistanceMeters: 1.2,
          safetyDistanceMeters: 0.55,
          stopConfirmSeconds: 0.2,
          avoidAdvanceDistanceMeters: 1.0,
        },
        timeoutSeconds: 20,
      }
    );

    let sawSlowing = false;
    let maxSlowScaleSeen = 1;
    let sawStoppedConfirm = false;

    for (let i = 0; i < 420; i++) {
      world.stepFrame(1 / 60);
      const av = world.getObstacleAvoidanceState();
      if (av.status === "slowing") {
        sawSlowing = true;
        maxSlowScaleSeen = Math.min(maxSlowScaleSeen, av.activeSpeedScale);
      }
      if (av.status === "stopped" && av.maneuverPhase === "stop-confirm") {
        sawStoppedConfirm = true;
        expect(av.commandedLinearVelocityMps).toBe(0);
      }
      if (av.status === "avoiding") {
        break;
      }
    }

    expect(sawSlowing).toBe(true);
    expect(maxSlowScaleSeen).toBeLessThan(0.8);
    expect(sawStoppedConfirm).toBe(true);
    expect(world.getObstacleAvoidanceState().status).toBe("avoiding");
  });

  it("chooses left vs right avoidance deterministically based on side sensor clearances", () => {
    const ctrl = new ReactiveObstacleAvoidanceController();
    const odo = makeReadyOdometry();

    // Case A: Left sensor sees obstacle at 0.45m, right sensor sees open 3.5m -> chooses RIGHT
    ctrl.beginNavigationSession({
      observations: [
        makeSyntheticObservation({ sensorId: "front", distanceMeters: 0.35, yaw: 0 }),
        makeSyntheticObservation({
          sensorId: "left-angled",
          distanceMeters: 0.45,
          yaw: 0.55,
          zOffset: 0.18,
        }),
        makeSyntheticObservation({
          sensorId: "right-angled",
          distanceMeters: 3.5,
          yaw: -0.55,
          zOffset: -0.18,
        }),
      ],
      navigationOptions: {
        enabled: true,
        safetyDistanceMeters: 0.5,
        slowdownDistanceMeters: 1.0,
        stopConfirmSeconds: 0.05,
      },
    });
    for (let i = 0; i < 10; i++) {
      ctrl.step({
        dtSeconds: 0.02,
        observations: [
          makeSyntheticObservation({ sensorId: "front", distanceMeters: 0.35, yaw: 0 }),
          makeSyntheticObservation({
            sensorId: "left-angled",
            distanceMeters: 0.45,
            yaw: 0.55,
            zOffset: 0.18,
          }),
          makeSyntheticObservation({
            sensorId: "right-angled",
            distanceMeters: 3.5,
            yaw: -0.55,
            zOffset: -0.18,
          }),
        ],
        odometry: odo,
      });
    }
    expect(ctrl.getState().status).toBe("avoiding");
    expect(ctrl.getState().chosenDirection).toBe("right");

    // Case B: Right sensor sees obstacle at 0.4m, left sensor sees open 3.2m -> chooses LEFT
    ctrl.reset();
    ctrl.beginNavigationSession({
      observations: [
        makeSyntheticObservation({ sensorId: "front", distanceMeters: 0.35, yaw: 0 }),
        makeSyntheticObservation({
          sensorId: "left-angled",
          distanceMeters: 3.2,
          yaw: 0.55,
          zOffset: 0.18,
        }),
        makeSyntheticObservation({
          sensorId: "right-angled",
          distanceMeters: 0.4,
          yaw: -0.55,
          zOffset: -0.18,
        }),
      ],
      navigationOptions: {
        enabled: true,
        safetyDistanceMeters: 0.5,
        slowdownDistanceMeters: 1.0,
        stopConfirmSeconds: 0.05,
      },
    });
    for (let i = 0; i < 10; i++) {
      ctrl.step({
        dtSeconds: 0.02,
        observations: [
          makeSyntheticObservation({ sensorId: "front", distanceMeters: 0.35, yaw: 0 }),
          makeSyntheticObservation({
            sensorId: "left-angled",
            distanceMeters: 3.2,
            yaw: 0.55,
            zOffset: 0.18,
          }),
          makeSyntheticObservation({
            sensorId: "right-angled",
            distanceMeters: 0.4,
            yaw: -0.55,
            zOffset: -0.18,
          }),
        ],
        odometry: odo,
      });
    }
    expect(ctrl.getState().status).toBe("avoiding");
    expect(ctrl.getState().chosenDirection).toBe("left");
  });

  it("avoids an obstacle on the direct path and resumes waypoint navigation to completion", () => {
    const centerBlock = makeBarrier({
      id: "mid-obstacle",
      name: "Center Obstacle",
      position: { x: 3.2, z: 0.05 },
      sizeX: 0.4,
      sizeZ: 0.4,
      heightM: 0.8,
    });
    const { world } = buildAvoidanceWorld({
      sensors: [
        { catalogueId: "elec-hcsr04-ultrasonic", position: [1.28, 0.15, 0] },
        {
          catalogueId: "elec-vl53l0x-tof",
          position: [1.25, 0.15, 0.45],
          rotation: [0, -0.5, 0], // +yaw left
        },
        {
          catalogueId: "elec-vl53l0x-tof",
          position: [1.25, 0.15, -0.45],
          rotation: [0, 0.5, 0], // -yaw right
        },
      ],
      barriers: [centerBlock],
    });
    world.start();

    const goal = { xMeters: 6.5, zMeters: 0.0, label: "Past Obstacle" };
    world.navigateToWaypoint(goal, {
      acceptanceRadiusMeters: 0.25,
      maxLinearSpeedMps: 1.0,
      timeoutSeconds: 25,
      obstacleAvoidance: {
        enabled: true,
        detectionDistanceMeters: 1.8,
        slowdownDistanceMeters: 1.15,
        safetyDistanceMeters: 0.6,
        minAvoidTurnRadians: 0.9,
        avoidAdvanceDistanceMeters: 2.5,
        avoidAdvanceSpeedMps: 0.7,
        stopConfirmSeconds: 0.12,
        verifyClearSeconds: 0.12,
      },
    });

    let enteredAvoiding = false;
    let enteredAdvance = false;
    let resumedClearAfterAvoidance = false;

    for (let i = 0; i < 1500; i++) {
      world.stepFrame(1 / 60);
      const av = world.getObstacleAvoidanceState();
      if (av.status === "avoiding") {
        enteredAvoiding = true;
        if (av.maneuverPhase === "advance") {
          enteredAdvance = true;
        }
      } else if (enteredAvoiding && (av.status === "clear" || av.status === "slowing")) {
        resumedClearAfterAvoidance = true;
      }
      if (!world.getNavigationState().isActive) break;
    }

    const nav = world.getNavigationState();
    const odo = world.getOdometryState();
    expect(enteredAvoiding).toBe(true);
    expect(enteredAdvance).toBe(true);
    expect(resumedClearAfterAvoidance).toBe(true);
    expect(nav.status).toBe("completed");
    expect(nav.currentTarget).toEqual(goal);
    expect(
      Math.hypot(odo.pose.xMeters - goal.xMeters, odo.pose.zMeters - goal.zMeters)
    ).toBeLessThanOrEqual(0.28);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("reports blocked/failed without endless oscillation when boxed in by unavoidable obstacles", () => {
    // 3.6m x 3.6m inner cage: 2.55m x 2.20m robot (diag half-radius 1.69m) spawns cleanly at origin and rotates without clipping
    const boxedBarriers: ArenaBarrier[] = [
      makeBarrier({
        id: "wall-front",
        name: "Wall Front",
        position: { x: 1.9, z: 0 },
        sizeX: 0.2,
        sizeZ: 4.0,
        heightM: 0.8,
      }),
      makeBarrier({
        id: "wall-left",
        name: "Wall Left",
        position: { x: 0, z: 1.9 },
        sizeX: 4.0,
        sizeZ: 0.2,
        heightM: 0.8,
      }),
      makeBarrier({
        id: "wall-right",
        name: "Wall Right",
        position: { x: 0, z: -1.9 },
        sizeX: 4.0,
        sizeZ: 0.2,
        heightM: 0.8,
      }),
      makeBarrier({
        id: "wall-rear",
        name: "Wall Rear",
        position: { x: -1.9, z: 0 },
        sizeX: 0.2,
        sizeZ: 4.0,
        heightM: 0.8,
      }),
    ];

    const { world } = buildAvoidanceWorld({ barriers: boxedBarriers });
    expect(world.getRenderPose().xMeters).toBeCloseTo(0, 4);
    expect(world.getRenderPose().zMeters).toBeCloseTo(0, 4);
    world.start();

    world.navigateToWaypoint(
      { xMeters: 4.0, zMeters: 0 },
      {
        timeoutSeconds: 20,
        obstacleAvoidance: {
          enabled: true,
          detectionDistanceMeters: 1.8,
          slowdownDistanceMeters: 1.35,
          safetyDistanceMeters: 0.65,
          clearHysteresisMeters: 0.45,
          maxAvoidanceAttempts: 2,
          stopConfirmSeconds: 0.08,
          avoidAdvanceDistanceMeters: 0.5,
        },
      }
    );

    for (let i = 0; i < 900; i++) {
      world.stepFrame(1 / 60);
      if (!world.getNavigationState().isActive) break;
    }

    expect(world.getObstacleAvoidanceState().status).toBe("blocked");
    expect(world.getObstacleAvoidanceState().failureReason).toBeTruthy();
    expect(world.getNavigationState().status).toBe("failed");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("maintains hysteresis around thresholds and preserves chosen direction during cooldown", () => {
    const ctrl = new ReactiveObstacleAvoidanceController();
    const odo = makeReadyOdometry();

    ctrl.beginNavigationSession({
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 0.85 })],
      navigationOptions: {
        enabled: true,
        safetyDistanceMeters: 0.45,
        slowdownDistanceMeters: 0.95,
        clearHysteresisMeters: 0.15,
        cooldownSeconds: 0.6,
        stopConfirmSeconds: 0.05,
        minAvoidTurnRadians: 0.5,
        avoidAdvanceDistanceMeters: 0.4,
        verifyClearSeconds: 0.05,
      },
    });

    // Enter slowing at 0.85 (< 0.95)
    ctrl.step({
      dtSeconds: 0.05,
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 0.85 })],
      odometry: odo,
    });
    expect(ctrl.getState().status).toBe("slowing");

    // Fluctuation at 1.02 (> 0.95 but <= 0.95 + 0.15 hysteresis = 1.10) stays "slowing" without flickering
    ctrl.step({
      dtSeconds: 0.05,
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 1.02 })],
      odometry: odo,
    });
    expect(ctrl.getState().status).toBe("slowing");

    // Exceeding exit threshold (> 1.10) returns cleanly to "clear"
    ctrl.step({
      dtSeconds: 0.05,
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 1.25 })],
      odometry: odo,
    });
    expect(ctrl.getState().status).toBe("clear");

    // Complete a quick "right" avoidance, then trigger another stop during cooldown with tied sensors
    ctrl.step({
      dtSeconds: 0.05,
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 0.35 })],
      odometry: odo,
    });
    ctrl.step({
      dtSeconds: 0.06,
      observations: [
        makeSyntheticObservation({ sensorId: "f", distanceMeters: 0.35 }),
        makeSyntheticObservation({ sensorId: "r", distanceMeters: 3.5, yaw: -0.5, zOffset: -0.2 }),
        makeSyntheticObservation({ sensorId: "l", distanceMeters: 0.4, yaw: 0.5, zOffset: 0.2 }),
      ],
      odometry: odo,
    });
    expect(ctrl.getState().chosenDirection).toBe("right");

    // Turn past minAvoidTurnRadians with open path -> advance -> verify-clear
    ctrl.step({
      dtSeconds: 0.05,
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 3.0 })],
      odometry: makeReadyOdometry({ heading: -0.8, traveled: 0 }),
    });
    expect(ctrl.getState().maneuverPhase).toBe("advance");
    ctrl.step({
      dtSeconds: 0.05,
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 3.0 })],
      odometry: makeReadyOdometry({ heading: -0.8, traveled: 0.5 }),
    });
    expect(ctrl.getState().maneuverPhase).toBe("verify-clear");
    ctrl.step({
      dtSeconds: 0.06,
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 3.0 })],
      odometry: makeReadyOdometry({ heading: -0.8, traveled: 0.5 }),
    });
    expect(ctrl.getState().status).toBe("clear");
    expect(ctrl.getState().cooldownRemainingSeconds).toBeGreaterThan(0.4);

    // Re-trigger immediately with symmetric headingError pointing left (+0.6 rad): cooldown biases "right" consistently
    ctrl.step({
      dtSeconds: 0.05,
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 0.3 })],
      odometry: makeReadyOdometry({ heading: -0.8, traveled: 0.5 }),
      headingErrorRadians: 0.6,
    });
    ctrl.step({
      dtSeconds: 0.06,
      observations: [makeSyntheticObservation({ sensorId: "f", distanceMeters: 0.3 })],
      odometry: makeReadyOdometry({ heading: -0.8, traveled: 0.5 }),
      headingErrorRadians: 0.6,
    });
    expect(ctrl.getState().chosenDirection).toBe("right");
  });

  it("handles missing/unpowered distance sensors, electrical faults, stop, reset, cancel, and manual takeover safely", () => {
    // 1. Missing sensor when avoidance is explicitly enabled -> blocked/failed without moving
    const { world: noSensorWorld } = buildAvoidanceWorld({ sensors: [] });
    noSensorWorld.start();
    const blockedNoSensor = noSensorWorld.navigateToWaypoint(
      { xMeters: 1.5, zMeters: 0 },
      { obstacleAvoidance: { enabled: true, requireValidSensor: true } }
    );
    expect(blockedNoSensor.status).toBe("failed");
    expect(noSensorWorld.getObstacleAvoidanceState().status).toBe("blocked");
    expect(noSensorWorld.getObstacleAvoidanceState().sensorStatus).toBe("not-installed");
    expect(noSensorWorld.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    // 2. Installed but unpowered distance sensor -> blocked/failed safely
    const { world: unpoweredSensorWorld } = buildAvoidanceWorld({
      sensors: [{ catalogueId: "elec-hcsr04-ultrasonic", position: [0.35, 0.15, 0] }],
      leaveSensorsUnpowered: true,
    });
    unpoweredSensorWorld.start();
    const blockedUnpowered = unpoweredSensorWorld.navigateToWaypoint({
      xMeters: 1.5,
      zMeters: 0,
    });
    expect(blockedUnpowered.status).toBe("failed");
    expect(unpoweredSensorWorld.getObstacleAvoidanceState().status).toBe("blocked");
    expect(unpoweredSensorWorld.getObstacleAvoidanceState().sensorStatus).toBe(
      "unavailable-unpowered"
    );

    // 3. Electrical power switch opened mid-run -> failed & throttles zeroed
    const { world: wiredWorld, switchId } = buildAvoidanceWorld({
      withFullPowerWiring: true,
    });
    wiredWorld.start();
    wiredWorld.navigateToWaypoint({ xMeters: 2.5, zMeters: 0 });
    for (let i = 0; i < 15; i++) {
      wiredWorld.stepFrame(1 / 60);
    }
    expect(wiredWorld.getNavigationState().status).toBe("navigating");
    expect(wiredWorld.getObstacleAvoidanceState().status).toBe("clear");

    wiredWorld.setSwitchState(switchId!, false);
    wiredWorld.stepFrame(1 / 60);
    expect(wiredWorld.getNavigationState().status).toBe("failed");
    expect(wiredWorld.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    // 4. Cancel, stopRobot, manual takeover, and reset lifecycle
    wiredWorld.setSwitchState(switchId!, true);
    wiredWorld.reset();
    wiredWorld.start();
    wiredWorld.navigateToWaypoint({ xMeters: 2.5, zMeters: 0 });
    wiredWorld.stepFrame(1 / 60);
    wiredWorld.cancelNavigation("Cancelled by user");
    expect(wiredWorld.getObstacleAvoidanceState().status).toBe("cancelled");

    wiredWorld.navigateToWaypoint({ xMeters: 2.5, zMeters: 0 });
    wiredWorld.stepFrame(1 / 60);
    wiredWorld.stopRobot();
    expect(wiredWorld.getObstacleAvoidanceState().status).toBe("cancelled");

    wiredWorld.navigateToWaypoint({ xMeters: 2.5, zMeters: 0 });
    wiredWorld.stepFrame(1 / 60);
    wiredWorld.setDriveControls({ forward: true, reverse: false, left: false, right: false });
    expect(wiredWorld.getObstacleAvoidanceState().status).toBe("cancelled");
    expect(wiredWorld.getControlState().controlSource).toBe("manual");

    wiredWorld.reset();
    expect(wiredWorld.getObstacleAvoidanceState().status).toBe("idle");
    expect(wiredWorld.getObstacleAvoidanceState().enabled).toBe(false);
  });

  it("preserves fixed-timestep determinism across frame rates and exposes ctx.avoidance to RobotControlRoutine", () => {
    const obstacle = makeBarrier({
      id: "det-obs",
      name: "Deterministic Obstacle",
      position: { x: 3.1, z: 0 },
      sizeX: 0.4,
      sizeZ: 0.4,
      heightM: 0.8,
    });

    const runAtRate = (dt: number, frames: number) => {
      useRobotStore.getState().startNewBuild();
      const { world } = buildAvoidanceWorld({
        drivetrainType: "differential-4",
        barriers: [obstacle],
      });
      world.start();
      world.navigateToWaypoint({ xMeters: 5.2, zMeters: 0 });
      for (let i = 0; i < frames; i++) {
        world.stepFrame(dt);
      }
      return {
        pose: world.getRenderPose(),
        odo: world.getOdometryState(),
        av: world.getObstacleAvoidanceState(),
      };
    };

    const fast = runAtRate(1 / 60, 120);
    const coarse = runAtRate(1 / 30, 60);
    expect(fast.pose).toEqual(coarse.pose);
    expect(fast.odo.pose).toEqual(coarse.odo.pose);
    expect(fast.av.stepCount).toBe(coarse.av.stepCount);
    expect(fast.av.status).toBe(coarse.av.status);

    // Program routine receives ctx.avoidance cleanly and completes when goal is reached
    useRobotStore.getState().startNewBuild();
    const { world: progWorld } = buildAvoidanceWorld({ barriers: [obstacle] });
    let sawAvoidanceContext = false;
    progWorld.setProgramRoutine({
      id: "avoid-patrol",
      name: "Obstacle-Aware Waypoint Routine",
      description: "Reaches waypoint past obstacle and finishes cleanly.",
      onStart: (api) => {
        api.navigateToWaypoint(
          { xMeters: 6.2, zMeters: 0 },
          {
            acceptanceRadiusMeters: 0.25,
            maxLinearSpeedMps: 1.0,
            timeoutSeconds: 25,
            obstacleAvoidance: {
              enabled: true,
              detectionDistanceMeters: 1.8,
              slowdownDistanceMeters: 1.15,
              safetyDistanceMeters: 0.6,
              avoidAdvanceDistanceMeters: 2.4,
              avoidAdvanceSpeedMps: 0.7,
              minAvoidTurnRadians: 0.9,
            },
          }
        );
      },
      onTick: (ctx, api) => {
        if (ctx.avoidance?.enabled) {
          sawAvoidanceContext = true;
        }
        if (ctx.navigation?.status === "completed") {
          api.completeProgram();
        }
      },
    });

    expect(progWorld.startProgram()).toBe(true);
    for (let i = 0; i < 1500; i++) {
      progWorld.stepFrame(1 / 60);
      if (progWorld.getControlState().programStatus === "completed") break;
    }

    expect(sawAvoidanceContext).toBe(true);
    expect(progWorld.getControlState().programStatus).toBe("completed");
    expect(progWorld.getNavigationState().status).toBe("completed");
  });
});
