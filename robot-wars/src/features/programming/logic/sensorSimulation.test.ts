import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { BUILTIN_CONTROL_ROUTINES } from "../data/builtInPrograms";
import {
  createRectangularArena,
  createRectangularSurfaceZone,
} from "../../simulation/logic/arenaModel";
import {
  OBSTACLE_TEST_ARENA,
  SimulationWorld,
} from "../../simulation/logic/simulationWorld";

function setupSensorTestRobot() {
  const store = useRobotStore.getState();
  store.startNewBuild();
  store.confirmFoundation();
  store.installBattery("standard-lipo"); // 11.1V (9.0-12.6V)
  store.installController("arduino-uno");

  store.selectMotorCatalogueItem("standard-dc");
  store.selectMountZone("front-left");
  store.placeMotor();
  store.selectMountZone("front-right");
  store.placeMotor();

  const st = useRobotStore.getState();
  const leftM = st.parts.find(
    (p) => p.type === "Motor" && p.mountingZoneId === "front-left"
  )!;
  const rightM = st.parts.find(
    (p) => p.type === "Motor" && p.mountingZoneId === "front-right"
  )!;
  st.selectWheelCatalogueItem("standard-rubber");
  st.assignWheel(leftM.id);
  useRobotStore.getState().assignWheel(rightM.id);
  useRobotStore.getState().applySuggestedDrivetrainMapping(true);
}

describe("Phase 6.1: Sensor API & Sensor Simulation", () => {
  beforeEach(() => {
    setupSensorTestRobot();
  });

  it("discovers installed sensors, handles missing/unsupported sensors cleanly, and respects sensor placement/orientation", () => {
    const store = useRobotStore.getState();
    const frontSonarId = store.installElectricalCatalogueItem(
      "elec-hcsr04-ultrasonic",
      {
        position: [0.4, 0.15, 0], // Front nose +X = 0.4m
      }
    )!;
    const rightSonarId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-hcsr04-ultrasonic", {
        position: [0, 0.15, -0.2],
      })!;
    // Rotate rightSonar around +Y by -PI/2 so +X faces -Z (toward East Perimeter Wall at Z = -6)
    useRobotStore
      .getState()
      .updatePartTransform(rightSonarId, [0, 0.15, -0.2], [0, Math.PI / 2, 0]);
    useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-temp-sensor");

    const state = useRobotStore.getState();
    // Use OBSTACLE_TEST_ARENA: West wall/North pillar at x = +2.8 (halfX = 0.45 -> front face at x = 2.35!)
    const world = SimulationWorld.fromAssembly({
      parts: state.parts,
      connections: state.connections,
      drivetrain: state.drivetrain,
      foundation: state.foundation,
      arena: OBSTACLE_TEST_ARENA,
    }).world!;

    const api = world.getControlApi();
    expect(api.getInstalledSensors()).toHaveLength(3);

    // Front sonar at x = 0.4 looking at pillar front face x = 2.35 -> distance = 1.95m!
    const frontRead = api.readUltrasonic(frontSonarId);
    expect(frontRead.ok).toBe(true);
    expect(frontRead.data?.distanceMeters).toBeCloseTo(1.95, 2);
    expect(frontRead.data?.hitBarrierId).toBe("barrier-north-pillar");

    // Sideways sonar rotated +PI/2 faces -Z and detects barrier-east-rail at z = -2.6 (distance 2.4m)
    const sideRead = api.readUltrasonic(rightSonarId);
    expect(sideRead.ok).toBe(true);
    expect(sideRead.data?.inRange).toBe(true);
    expect(sideRead.data?.hitBarrierId).toBe("barrier-east-rail");
    expect(sideRead.data?.distanceMeters).toBeCloseTo(2.4, 2);

    // Missing sensor kind returns clean typed error state without throwing
    const missingLine = api.readLineSensor();
    expect(missingLine.ok).toBe(false);
    expect(missingLine.status).toBe("not-installed");
    expect(missingLine.data).toBeNull();

    // Unsupported sensor kind returns explicit unavailable status
    const tempSensor = api
      .getInstalledSensors()
      .find((s) => s.sensorKind === "temperature")!;
    expect(tempSensor.availability).toBe("unavailable-unsupported");
  });

  it("gates sensor availability when electrical wiring has unpowered or faulted sensor supplies", () => {
    const store = useRobotStore.getState();
    const sonarId = store.installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!;
    const buckId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-buck-5v")!;
    const st1 = useRobotStore.getState();
    const batId = st1.parts.find((p) => p.type === "Battery")!.id;
    const ctrlId = st1.parts.find((p) => p.type === "Controller")!.id;

    // Wire Controller only -> now electrical wiring exists on robot, leaving Sonar UNPOWERED!
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: ctrlId,
      targetInterfaceId: "ctrl-power-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    const unpoweredState = useRobotStore.getState();
    const unpoweredWorld = SimulationWorld.fromAssembly({
      parts: unpoweredState.parts,
      connections: unpoweredState.connections,
      drivetrain: unpoweredState.drivetrain,
      foundation: unpoweredState.foundation,
      electricalConnections: unpoweredState.electricalConnections,
    }).world!;

    const unpoweredRead = unpoweredWorld.getControlApi().readUltrasonic(sonarId);
    expect(unpoweredRead.ok).toBe(false);
    expect(unpoweredRead.status).toBe("unavailable-unpowered");

    // Wire 11.1V Battery -> 5V Buck -> 5V Sonar cleanly
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-pwr-out",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    const poweredState = useRobotStore.getState();
    const poweredWorld = SimulationWorld.fromAssembly({
      parts: poweredState.parts,
      connections: poweredState.connections,
      drivetrain: poweredState.drivetrain,
      foundation: poweredState.foundation,
      electricalConnections: poweredState.electricalConnections,
    }).world!;

    expect(poweredWorld.getControlApi().readUltrasonic(sonarId).ok).toBe(true);
  });

  it("simulates IR proximity, line-following zones, IMU kinematics, and deterministic wheel encoders across motion and reset", () => {
    const store = useRobotStore.getState();
    store.installElectricalCatalogueItem("elec-ir-obstacle", {
      position: [0.35, 0.1, 0],
    });
    store.installElectricalCatalogueItem("elec-line-follower", {
      position: [0.2, 0.02, 0],
    });
    store.installElectricalCatalogueItem("elec-mpu6050-imu", {
      position: [0, 0.12, 0],
    });
    const leftEncId = store.installElectricalCatalogueItem(
      "elec-quadrature-encoder",
      { position: [0, 0.1, 0.25] }
    )!;
    const rightEncId = store.installElectricalCatalogueItem(
      "elec-quadrature-encoder",
      { position: [0, 0.1, -0.25] }
    )!;

    // Arena with a high-contrast black line zone strip ahead at x in [0.5, 1.5]
    const lineArena = createRectangularArena({
      id: "line-track-arena",
      name: "Line Test Arena",
      lengthM: 10,
      widthM: 10,
      surfaceZones: [
        createRectangularSurfaceZone({
          id: "black-track-line",
          name: "Center Track Line Marking",
          bounds: { minX: 0.45, maxX: 1.5, minZ: -0.05, maxZ: 0.05 },
          surface: "rubber-high-grip",
          priority: 2,
        }),
      ],
    });

    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      arena: lineArena,
    }).world!;

    const api = world.getControlApi();
    expect(api.readLineSensor().data?.detected).toBe(false);
    expect(api.readEncoder(leftEncId).data?.ticks).toBe(0);

    // Drive forward onto line strip
    world.start();
    world.setMotorPower("both", 0.7);
    for (let i = 0; i < 60; i++) {
      world.stepFrame(1 / 60);
    }

    const lineRead = api.readLineSensor();
    expect(lineRead.ok).toBe(true);
    expect(lineRead.data?.detected).toBe(true);
    expect(lineRead.data?.channels.some(Boolean)).toBe(true);

    const encL = api.readEncoder(leftEncId);
    const encR = api.readEncoder(rightEncId);
    expect(encL.ok && encR.ok).toBe(true);
    expect(encL.data!.ticks).toBeGreaterThan(20);
    expect(encL.data!.distanceMeters).toBeGreaterThan(0.1);
    expect(encL.data!.side).toBe("left");
    expect(encR.data!.side).toBe("right");

    // Pivot clockwise -> IMU registers nonzero yaw rate and angular change
    world.getControlApi().setDifferentialPower(0.8, -0.8);
    for (let i = 0; i < 20; i++) {
      world.stepFrame(1 / 60);
    }
    const imuRead = api.readImu();
    expect(imuRead.ok).toBe(true);
    expect(Math.abs(imuRead.data!.yawRateRadPerSec)).toBeGreaterThan(0.05);

    // Deterministic reset zeroes encoder accumulators cleanly
    world.reset();
    expect(api.readEncoder(leftEncId).data?.ticks).toBe(0);
    expect(api.readEncoder(rightEncId).data?.distanceMeters).toBe(0);
  });

  it("closes autonomous sensor-control loop cleanly with built-in Ultrasonic Obstacle Guard routine", () => {
    const store = useRobotStore.getState();
    store.installElectricalCatalogueItem("elec-hcsr04-ultrasonic", {
      position: [1.25, 0.15, 0], // Mounted on front bumper nose
    });
    const st = useRobotStore.getState();

    // OBSTACLE_TEST_ARENA places barrier-north-pillar front at x = +2.35m directly ahead of robot!
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      arena: OBSTACLE_TEST_ARENA,
    }).world!;

    const guardRoutine = BUILTIN_CONTROL_ROUTINES.find(
      (r) => r.id === "program-ultrasonic-guard"
    )!;
    world.setProgramRoutine(guardRoutine);
    world.startProgram();

    const initialDist = world.getControlApi().readUltrasonic().data!.distanceMeters;
    for (let i = 0; i < 360; i++) {
      world.stepFrame(1 / 60);
    }
    const finalControl = world.getControlState();
    const finalDist = world.getControlApi().readUltrasonic().data!.distanceMeters;

    expect(finalDist).toBeLessThan(initialDist);
    expect(finalDist).toBeLessThan(0.8);
    expect(finalControl.programStatus).toBe("completed");
    expect(finalControl.leftPower).toBe(0);
    expect(finalControl.rightPower).toBe(0);
  });
});
