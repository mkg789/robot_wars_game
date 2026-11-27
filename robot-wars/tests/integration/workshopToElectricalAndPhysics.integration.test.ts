import { beforeEach, describe, expect, it } from "vitest";
import { validateElectricalAssembly } from "../../src/features/electrical/logic/electricalValidation";
import { analyzePowerDistribution } from "../../src/features/electrical/logic/powerDistributionAnalysis";
import { validateRobotAssembly } from "../../src/features/robot-builder/logic/assemblyValidation";
import { validateDrivetrain } from "../../src/features/robot-builder/logic/drivetrain";
import { resolveAssemblyMass } from "../../src/features/robot-builder/logic/massResolvers";
import { SimulationWorld } from "../../src/features/simulation/logic/simulationWorld";
import { useRobotStore } from "../../src/store/robotStore";
import {
  assembleConfiguredRobotFixture,
  wireCommonGroundFixture,
} from "../fixtures/robotFixtures";

describe("Integration Journeys 1–4: Workshop Assembly, Drivetrain, Electrical & Physics Loop", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("Journey 1 & 2: builds complete 2WD and 4WD robots, swaps components, updates drivetrain mapping, and computes consistent mass/validation", () => {
    const twoWd = assembleConfiguredRobotFixture({
      drivetrainType: "differential-2",
      addStructuralPart: true,
    });
    const st2 = useRobotStore.getState();

    const assembly2Report = validateRobotAssembly({
      parts: st2.parts,
      connections: st2.connections,
      electricalConnections: st2.electricalConnections,
      foundation: st2.foundation,
      drivetrain: st2.drivetrain,
    });
    expect(assembly2Report.errors).toHaveLength(0);
    expect(twoWd.structuralPartId).toBeTruthy();

    const dt2 = validateDrivetrain(
      st2.drivetrain,
      st2.parts,
      st2.connections,
      st2.foundation
    );
    expect(dt2.isValid).toBe(true);
    expect(st2.drivetrain.left).toHaveLength(1);
    expect(st2.drivetrain.right).toHaveLength(1);
    const mass2 = resolveAssemblyMass(st2.parts).totalMassKg;
    expect(mass2).toBeGreaterThan(1);

    // Journey 2 upgrade: switch to differential-4, add rear motors + wheels, swap structural armor
    st2.setDrivetrainType("differential-4", true);
    for (const zoneId of ["rear-left", "rear-right"]) {
      useRobotStore.getState().selectMotorCatalogueItem("high-torque-dc");
      useRobotStore.getState().selectMountZone(zoneId);
      useRobotStore.getState().placeMotor();
    }
    const rearMotors = useRobotStore
      .getState()
      .parts.filter(
        (part) =>
          part.type === "Motor" &&
          (part.mountingZoneId === "rear-left" ||
            part.mountingZoneId === "rear-right")
      );
    for (const motor of rearMotors) {
      useRobotStore.getState().selectWheelCatalogueItem("heavy-duty");
      useRobotStore.getState().assignWheel(motor.id);
    }
    useRobotStore.getState().applySuggestedDrivetrainMapping(true);

    const st4 = useRobotStore.getState();
    const dt4 = validateDrivetrain(
      st4.drivetrain,
      st4.parts,
      st4.connections,
      st4.foundation
    );
    expect(dt4.isValid).toBe(true);
    expect(st4.drivetrain.left.filter(Boolean)).toHaveLength(2);
    expect(st4.drivetrain.right.filter(Boolean)).toHaveLength(2);
    const mass4 = resolveAssemblyMass(st4.parts).totalMassKg;
    expect(mass4).toBeGreaterThan(mass2);
  });

  it("Journey 3: handles reversed wire endpoint direction, regulated downstream fuse load, and branch-local fault isolation", () => {
    const store = useRobotStore.getState();
    store.confirmFoundation();

    const batId = store.installElectricalCatalogueItem("elec-lipo-3s")!;
    const fuseHealthyId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-inline-fuse-20a")!;
    const buckHealthyId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-buck-5v")!;
    const servoHealthyId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-servo-actuator")!;

    // Branch 2: intentionally faulty direct 11.1V -> 5V servo overvoltage branch
    const fuseFaultyId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-inline-fuse-20a")!;
    const faultServoId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-servo-actuator")!;

    const addConn = useRobotStore.getState().addElectricalConnection;
    // Healthy branch wired in REVERSED endpoint order (target listed as sourcePartId!)
    addConn({
      sourcePartId: fuseHealthyId,
      sourceInterfaceId: "fuse-in",
      targetPartId: batId,
      targetInterfaceId: "bat-power-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: buckHealthyId,
      sourceInterfaceId: "elec-buck-5v-pwr-in",
      targetPartId: fuseHealthyId,
      targetInterfaceId: "fuse-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: servoHealthyId,
      sourceInterfaceId: "servo-pwr-in",
      targetPartId: buckHealthyId,
      targetInterfaceId: "elec-buck-5v-pwr-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    // Faulty branch: bypasses 5V buck converter directly from 11.1V LiPo into 4.8-6.0V servo -> overvoltage fault
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: fuseFaultyId,
      targetInterfaceId: "fuse-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: fuseFaultyId,
      sourceInterfaceId: "fuse-out",
      targetPartId: faultServoId,
      targetInterfaceId: "servo-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    wireCommonGroundFixture(
      [buckHealthyId, servoHealthyId, faultServoId],
      batId
    );

    const st = useRobotStore.getState();
    const { analysis } = analyzePowerDistribution({
      parts: st.parts,
      electricalConnections: st.electricalConnections,
    });
    const val = validateElectricalAssembly({
      parts: st.parts,
      electricalConnections: st.electricalConnections,
    });

    // Regulated healthy servo receives 5V despite reversed connection endpoint order!
    const healthyServoState = analysis.consumerStates[servoHealthyId];
    expect(healthyServoState?.energized).toBe(true);
    expect(healthyServoState?.deliveredVoltageV?.nominalV).toBeCloseTo(5.0, 2);

    // Faulty overvolted servo reports voltage fault without killing healthy branch or falsely faulting healthy servo
    const healthyFaults = val.diagnostics.filter(
      (d) => d.partId === servoHealthyId && d.severity === "error"
    );
    expect(healthyFaults).toHaveLength(0);

    const overvoltageFaults = val.diagnostics.filter(
      (d) => d.partId === faultServoId && d.severity === "error"
    );
    expect(overvoltageFaults.length).toBeGreaterThan(0);
  });

  it("Journey 4: couples electrical power state to SimulationWorld physics (healthy drive vs unpowered motors)", () => {
    const { leftMotorId, rightMotorId } = assembleConfiguredRobotFixture({
      wireEscAndMotors: true,
    });
    const stHealthy = useRobotStore.getState();
    const healthyWorld = SimulationWorld.fromAssembly({
      parts: stHealthy.parts,
      connections: stHealthy.connections,
      drivetrain: stHealthy.drivetrain,
      foundation: stHealthy.foundation,
      electricalConnections: stHealthy.electricalConnections,
    }).world!;

    healthyWorld.start();
    healthyWorld.setDriveControls({
      forward: true,
      reverse: false,
      left: false,
      right: false,
    });
    for (let i = 0; i < 45; i++) {
      healthyWorld.stepFrame(1 / 60);
    }
    const healthyPose = healthyWorld.getRenderPose();
    const healthyDistance = Math.hypot(
      healthyPose.xMeters,
      healthyPose.zMeters
    );
    expect(healthyDistance).toBeGreaterThan(0.15);

    // Unpower motor wires cleanly and confirm robot barely moves under identical drive controls
    for (const motorId of [leftMotorId, rightMotorId]) {
      const conn = useRobotStore
        .getState()
        .electricalConnections.find(
          (c) =>
            (c.targetPartId === motorId || c.sourcePartId === motorId) &&
            c.connectionType === "power"
        );
      if (conn) {
        useRobotStore.getState().removeElectricalConnection(conn.id);
      }
    }

    const stUnpowered = useRobotStore.getState();
    const unpoweredWorld = SimulationWorld.fromAssembly({
      parts: stUnpowered.parts,
      connections: stUnpowered.connections,
      drivetrain: stUnpowered.drivetrain,
      foundation: stUnpowered.foundation,
      electricalConnections: stUnpowered.electricalConnections,
    }).world!;

    unpoweredWorld.start();
    unpoweredWorld.setDriveControls({
      forward: true,
      reverse: false,
      left: false,
      right: false,
    });
    for (let i = 0; i < 45; i++) {
      unpoweredWorld.stepFrame(1 / 60);
    }
    const unpoweredPose = unpoweredWorld.getRenderPose();
    const unpoweredDistance = Math.hypot(
      unpoweredPose.xMeters,
      unpoweredPose.zMeters
    );
    expect(unpoweredDistance).toBeLessThan(healthyDistance * 0.15);
  });
});
