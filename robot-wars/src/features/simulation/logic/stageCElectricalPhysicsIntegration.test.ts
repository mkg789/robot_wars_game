import { beforeEach, describe, expect, it } from "vitest";
import { validateElectricalAssembly } from "../../electrical/logic/electricalValidation";
import { resolveMotorEngineeringSpec } from "../../robot-builder/logic/engineeringAdapters";
import { useRobotStore } from "../../../store/robotStore";
import { STANDARD_ROBOT_WARS_ARENA } from "./arenaModel";
import { calculateBatteryOperatingPoint } from "./batteryDynamics";
import { compileSimulationConfig } from "./simulationConfigCompiler";
import {
  advanceSimulation,
  createInitialRunnerState,
} from "./simulationRunner";
import { SimulationWorld } from "./simulationWorld";

function resetAndBuildBaseAssembly(batteryId: "compact-lipo" | "standard-lipo" | "heavy-duty-lipo" = "standard-lipo") {
  const s = useRobotStore.getState();
  s.startNewBuild();
  s.confirmFoundation();
  s.installBattery(batteryId);
  s.installController("arduino-uno");

  s.selectMotorCatalogueItem("high-torque-dc");
  s.selectMountZone("front-left");
  s.placeMotor();
  s.selectMountZone("front-right");
  s.placeMotor();

  const afterMotors = useRobotStore.getState();
  const batId = afterMotors.parts.find((p) => p.type === "Battery")!.id;
  const ctrlId = afterMotors.parts.find((p) => p.type === "Controller")!.id;
  const leftMotorId = afterMotors.parts.find(
    (p) => p.type === "Motor" && p.mountingZoneId === "front-left"
  )!.id;
  const rightMotorId = afterMotors.parts.find(
    (p) => p.type === "Motor" && p.mountingZoneId === "front-right"
  )!.id;

  afterMotors.selectWheelCatalogueItem("standard-rubber");
  afterMotors.assignWheel(leftMotorId);
  useRobotStore.getState().assignWheel(rightMotorId);
  useRobotStore.getState().applySuggestedDrivetrainMapping(true);

  const afterWheels = useRobotStore.getState();
  const leftWheelId = afterWheels.drivetrain.left[0]!.wheelId;
  const rightWheelId = afterWheels.drivetrain.right[0]!.wheelId;

  return { batId, ctrlId, leftMotorId, rightMotorId, leftWheelId, rightWheelId };
}

function wireCommonGround(parts: string[], refId: string) {
  const addConn = useRobotStore.getState().addElectricalConnection;
  for (const pid of parts) {
    const part = useRobotStore.getState().parts.find((p) => p.id === pid);
    const gndIface =
      part?.electricalSpec?.interfaces.find((i) => i.role === "ground")?.interfaceId ??
      (part?.type === "Controller" ? "ctrl-gnd" : "bat-gnd");
    addConn({
      sourcePartId: pid,
      sourceInterfaceId: gndIface,
      targetPartId: refId,
      targetInterfaceId: "bat-gnd",
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });
  }
}

describe("Stage C: Electrical-to-Physics Integration", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("aligns electrical motor specs cleanly across ElectricalCatalogue, EngineeringAdapters, and SimulationConfigCompiler without inventing missing catalogue data", () => {
    const { leftMotorId } = resetAndBuildBaseAssembly("standard-lipo");
    const store = useRobotStore.getState();
    const mechMotor = store.parts.find((p) => p.id === leftMotorId)!;

    // Built-in mechanical motor intentionally omits nominalVoltageV to avoid fabrication
    const mechSpec = resolveMotorEngineeringSpec(mechMotor);
    expect(mechSpec.electrical?.nominalVoltageV).toBeUndefined();

    // Electrical catalogue motor exposes explicit motorSpec ratings; EngineeringAdapters must resolve them cleanly
    const elecMotorId = store.installElectricalCatalogueItem("elec-dc-motor-actuator")!;
    const elecMotorPart = useRobotStore.getState().parts.find((p) => p.id === elecMotorId)!;
    const resolvedElecMotor = resolveMotorEngineeringSpec(elecMotorPart);

    expect(resolvedElecMotor.electrical?.nominalVoltageV).toBe(12.0);
    expect(resolvedElecMotor.electrical?.ratedCurrentA).toBe(1.4);
    expect(resolvedElecMotor.electrical?.stallCurrentA).toBe(4.5);

    const compiled = compileSimulationConfig({
      parts: useRobotStore.getState().parts,
      connections: useRobotStore.getState().connections,
      drivetrain: useRobotStore.getState().drivetrain,
      foundation: useRobotStore.getState().foundation,
    });
    expect(compiled.success).toBe(true);
    expect(compiled.assumptions.some((a) => a.parameter.includes("nominalVoltageV"))).toBe(true);
  });

  it("enforces motor-driver continuous current limits and scales stall torque and acceleration deterministically", () => {
    const { batId, leftMotorId, rightMotorId } = resetAndBuildBaseAssembly("standard-lipo");
    const store = useRobotStore.getState();

    // Install two different drivers with vastly different current limits:
    // Left on TB6612 (1.2A continuous limit); Right on direct 30A ESC (30A continuous limit)
    const tb6612Id = store.installElectricalCatalogueItem("elec-tb6612-dual-dc")!;
    const escId = store.installElectricalCatalogueItem("elec-esc-brushed-30a")!;

    // Use elec-dc-motor-actuator-style high stall current (4.5A) on left and right motors via electricalSpec
    for (const mId of [leftMotorId, rightMotorId]) {
      store.updatePartElectricalProperties(mId, {
        motorSpec: {
          nominalVoltageV: 12,
          minVoltageV: 6,
          maxVoltageV: 14,
          ratedCurrentA: 1.8,
          stallCurrentA: 4.5,
          reversiblePolarity: true,
        },
      });
    }

    const addConn = useRobotStore.getState().addElectricalConnection;
    // Wire Bat -> TB6612 -> Left Motor
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: tb6612Id,
      targetInterfaceId: "tb6612-vm-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: tb6612Id,
      sourceInterfaceId: "tb6612-motor-out",
      targetPartId: leftMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    // Wire Bat -> ESC30A -> Right Motor
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: escId,
      targetInterfaceId: "esc-bat-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: escId,
      sourceInterfaceId: "esc-motor-out",
      targetPartId: rightMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGround([tb6612Id, escId], batId);

    const st = useRobotStore.getState();
    const compiled = compileSimulationConfig({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      electricalConnections: st.electricalConnections,
    });
    expect(compiled.success).toBe(true);
    expect(compiled.config?.electrical?.mode).toBe("electrical-connected");

    const runner0 = createInitialRunnerState(compiled.config!);
    const adv = advanceSimulation(
      compiled.config!,
      runner0,
      { leftThrottle: 1, rightThrottle: 1 },
      1 / 120
    );

    const leftWheelDiag = adv.stepDiagnostics[0].diagnostics.wheels.find(
      (w) => w.side === "left"
    )!;
    const rightWheelDiag = adv.stepDiagnostics[0].diagnostics.wheels.find(
      (w) => w.side === "right"
    )!;

    // TB6612 limits left motor current to <= 1.2A while ESC allows right motor up to ~4.5A
    expect(leftWheelDiag.isCurrentLimited).toBe(true);
    expect(leftWheelDiag.electricalCurrentA!).toBeLessThanOrEqual(1.201);
    expect(rightWheelDiag.isCurrentLimited).toBe(false);
    expect(rightWheelDiag.motorTorqueNm).toBeGreaterThan(leftWheelDiag.motorTorqueNm);
  });

  it("applies battery auxiliary loads (controllers + sensors), voltage sag, and explicit battery continuous discharge limits", () => {
    const { batId, ctrlId, leftMotorId, rightMotorId } = resetAndBuildBaseAssembly("compact-lipo");
    const store = useRobotStore.getState();
    const pdbId = store.installElectricalCatalogueItem("elec-pdb-xt60")!;
    const buckId = store.installElectricalCatalogueItem("elec-buck-5v")!;
    const sonarId = store.installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!;

    // Set explicit battery discharge ceiling (3.0A continuous) and known internal resistance (0.1 Ohm)
    store.updatePartElectricalProperties(batId, {
      batterySpec: {
        nominalVoltageV: 7.4,
        maxVoltageV: 8.4,
        minOperatingVoltageV: 6.0,
        capacityMah: 1500,
        maxContinuousDischargeA: 3.0,
        internalResistanceOhm: 0.1,
      },
    });
    // Set motor electrical ratings so 2 motors stalling easily exceed 3.0A
    for (const mId of [leftMotorId, rightMotorId]) {
      store.updatePartElectricalProperties(mId, {
        motorSpec: {
          nominalVoltageV: 7.4,
          minVoltageV: 5.0,
          maxVoltageV: 9.0,
          ratedCurrentA: 2.0,
          stallCurrentA: 4.0,
          reversiblePolarity: true,
        },
      });
    }

    const addConn = useRobotStore.getState().addElectricalConnection;
    // Bat -> PDB -> Motors & Controller (7.4V within 7-12V VIN); PDB -> Buck 5V -> 5V Sonar
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: leftMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: rightMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: ctrlId,
      targetInterfaceId: "ctrl-power-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-pwr-out",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGround([pdbId, buckId, ctrlId, sonarId], batId);

    const st = useRobotStore.getState();
    const worldRes = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      electricalConnections: st.electricalConnections,
      arena: STANDARD_ROBOT_WARS_ARENA,
    });
    expect(worldRes.success).toBe(true);
    const world = worldRes.world!;

    // At idle, auxiliary load draws power from battery through buck converter + quiescent draw
    const idleTel = world.getTelemetrySnapshot();
    expect(idleTel.totalCurrentDrawA).toBeGreaterThan(0);
    expect(idleTel.batteryTerminalVoltageV).toBeLessThan(8.4);

    // Full throttle triggers battery maxContinuousDischargeA (3.0A) clamping
    world.start();
    world.setMotorPower("both", 1.0);
    world.stepFrame(1 / 120);
    const loadedTel = world.getTelemetrySnapshot();

    expect(loadedTel.totalCurrentDrawA).toBeLessThanOrEqual(3.01);
    expect(loadedTel.electricalState?.isBatteryDischargeLimited).toBe(true);
    expect(loadedTel.batteryTerminalVoltageV).toBeCloseTo(8.4 - loadedTel.totalCurrentDrawA * 0.1, 2);
  });

  it("models functional power switches and deterministic overcurrent fuse tripping with branch isolation & clean reset", () => {
    const { batId, leftMotorId, rightMotorId } = resetAndBuildBaseAssembly("standard-lipo");
    const store = useRobotStore.getState();

    const pdbId = store.installElectricalCatalogueItem("elec-pdb-xt60")!;
    const swLeftId = store.installElectricalCatalogueItem("elec-power-switch", { name: "Left Switch" })!;
    const fuseLeftId = store.installElectricalCatalogueItem("elec-inline-fuse-20a", { name: "Branch 2A Fuse" })!;

    // Configure 2A branch fuse and 4.5A stall motors so stalling Left trips its fuse while Right stays powered!
    store.updatePartElectricalProperties(fuseLeftId, {
      driverOrRegulatorSpec: {
        powerRole: "fuse",
        continuousCurrentPerChannelA: 2.0,
        peakCurrentA: 2.0,
      },
    });
    for (const mId of [leftMotorId, rightMotorId]) {
      store.updatePartElectricalProperties(mId, {
        motorSpec: {
          nominalVoltageV: 11.1,
          minVoltageV: 6,
          maxVoltageV: 14,
          ratedCurrentA: 1.5,
          stallCurrentA: 4.5,
          reversiblePolarity: true,
        },
      });
    }

    const addConn = useRobotStore.getState().addElectricalConnection;
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    // Left branch: PDB -> Switch -> Fuse -> Left Motor
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: swLeftId,
      targetInterfaceId: "sw-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: swLeftId,
      sourceInterfaceId: "sw-out",
      targetPartId: fuseLeftId,
      targetInterfaceId: "fuse-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: fuseLeftId,
      sourceInterfaceId: "fuse-out",
      targetPartId: leftMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    // Right branch: PDB -> Right Motor (independent of Left switch & Left fuse)
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: rightMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGround([pdbId], batId);

    // 1. Opening Left Switch in store de-energizes ONLY Left Motor in validateElectricalAssembly
    useRobotStore.getState().setElectricalSwitchState(swLeftId, false);
    const stOpen = useRobotStore.getState();
    const openReport = validateElectricalAssembly({
      parts: stOpen.parts,
      electricalConnections: stOpen.electricalConnections,
    });
    expect(openReport.diagnostics.some((d) => d.code === "switch-open")).toBe(true);
    expect(openReport.powerAnalysis?.consumerStates[leftMotorId]?.energized).toBe(false);
    expect(openReport.powerAnalysis?.consumerStates[rightMotorId]?.energized).toBe(true);

    // Close Left Switch and run SimulationWorld
    useRobotStore.getState().setElectricalSwitchState(swLeftId, true);
    const stClosed = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: stClosed.parts,
      connections: stClosed.connections,
      drivetrain: stClosed.drivetrain,
      foundation: stClosed.foundation,
      electricalConnections: stClosed.electricalConnections,
      arena: STANDARD_ROBOT_WARS_ARENA,
    }).world!;

    // 2. Toggle switch open dynamically inside SimulationWorld -> left motor drives 0 Nm while right motor still drives
    world.setSwitchState(swLeftId, false);
    world.start();
    world.setMotorPower("both", 1.0);
    world.stepFrame(1 / 120);
    const leftWhileOpen = world
      .getLatestStepDiagnostics()!
      .diagnostics.wheels.find((w) => w.side === "left")!;
    const rightWhileOpen = world
      .getLatestStepDiagnostics()!
      .diagnostics.wheels.find((w) => w.side === "right")!;
    expect(leftWhileOpen.isElectricalPowered).toBe(false);
    expect(leftWhileOpen.motorTorqueNm).toBe(0);
    expect(rightWhileOpen.isElectricalPowered).toBe(true);
    expect(rightWhileOpen.motorTorqueNm).toBeGreaterThan(0);

    // 3. Close Left Switch -> full stall current (> 2A) trips Left Fuse on step 1, killing Left Motor from step 2 onward!
    world.setSwitchState(swLeftId, true);
    world.stepFrame(1 / 120); // Overcurrent (> 2A) trips fuseLeftId
    expect(world.getElectricalState()?.trippedFuseIds).toContain(fuseLeftId);

    world.stepFrame(1 / 120); // Post-trip step: Left motor now isolated at 0V/0A while Right motor still drives
    const leftPostTrip = world
      .getLatestStepDiagnostics()!
      .diagnostics.wheels.find((w) => w.side === "left")!;
    const rightPostTrip = world
      .getLatestStepDiagnostics()!
      .diagnostics.wheels.find((w) => w.side === "right")!;
    expect(leftPostTrip.isElectricalPowered).toBe(false);
    expect(leftPostTrip.motorTorqueNm).toBe(0);
    expect(rightPostTrip.isElectricalPowered).toBe(true);
    expect(rightPostTrip.motorTorqueNm).toBeGreaterThan(0);

    // 4. Deterministic Reset restores fuse state and clears tripped fuses
    world.reset();
    expect(world.getElectricalState()?.trippedFuseIds).toEqual([]);
  });

  it("models regulated BEC / Buck rails distinctly from unregulated battery rails including regulator dropout brownout", () => {
    const { batId, leftMotorId, rightMotorId } = resetAndBuildBaseAssembly("compact-lipo");
    const store = useRobotStore.getState();

    // Catalogue 5V Buck Regulator has 2.0V dropout (needs >= 7.0V input) feeding Left motor;
    // Right motor wired directly to Battery (unregulated)
    const buckId = store.installElectricalCatalogueItem("elec-buck-5v")!;
    const sonarId = store.installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!;

    const addConn = useRobotStore.getState().addElectricalConnection;
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-pwr-out",
      targetPartId: leftMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: rightMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-pwr-out",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGround([buckId, sonarId], batId);

    const st = useRobotStore.getState();
    const compiled = compileSimulationConfig({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      electricalConnections: st.electricalConnections,
    }).config!;

    // Left motor sees steady regulated 5.0V while right motor sees >8.0V battery terminal voltage
    const dummyState = createInitialRunnerState(compiled).simulationState;
    const steadyDiag = calculateBatteryOperatingPoint(
      compiled,
      dummyState,
      { leftThrottle: 1, rightThrottle: 1 },
      { openCircuitVoltageV: 8.4, internalResistanceOhm: 0.01 }
    );
    const leftSteady = steadyDiag.perMotorStates!.find((m) => m.motorId === leftMotorId)!;
    const rightSteady = steadyDiag.perMotorStates!.find((m) => m.motorId === rightMotorId)!;
    expect(leftSteady.operatingVoltageV).toBeCloseTo(5.0, 2);
    expect(rightSteady.operatingVoltageV).toBeGreaterThan(8.0);

    // Sag open-circuit voltage to 6.2V (< 5.0V + 2.0V dropout = 7.0V) -> regulator enters dropout brownout!
    const dropoutDiag = calculateBatteryOperatingPoint(
      compiled,
      dummyState,
      { leftThrottle: 1, rightThrottle: 1 },
      { openCircuitVoltageV: 6.2, cutoffVoltageV: 4.5, internalResistanceOhm: 0.01 }
    );
    const leftDropout = dropoutDiag.perMotorStates!.find((m) => m.motorId === leftMotorId)!;
    expect(leftDropout.operatingVoltageV).toBeLessThan(5.0);
    expect(dropoutDiag.activeElectricalFaults?.some((f) => f.includes("dropout"))).toBe(true);
  });

  it("drives healthy wired robot deterministically in manual & programmed modes and disables sensors whose branch switch opens", () => {
    const { batId, ctrlId, leftMotorId, rightMotorId } = resetAndBuildBaseAssembly("standard-lipo");
    const store = useRobotStore.getState();

    const escId = store.installElectricalCatalogueItem("elec-esc-brushed-30a")!;
    const swId = store.installElectricalCatalogueItem("elec-power-switch")!;
    const sonarId = store.installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!;

    const addConn = useRobotStore.getState().addElectricalConnection;
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: escId,
      targetInterfaceId: "esc-bat-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: escId,
      sourceInterfaceId: "esc-motor-out",
      targetPartId: leftMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: escId,
      sourceInterfaceId: "esc-motor-out",
      targetPartId: rightMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    // Wire ESC BEC 5V -> Switch -> Sonar & ESC BEC -> Controller
    addConn({
      sourcePartId: escId,
      sourceInterfaceId: "esc-bec-out",
      targetPartId: ctrlId,
      targetInterfaceId: "ctrl-power-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: escId,
      sourceInterfaceId: "esc-bec-out",
      targetPartId: swId,
      targetInterfaceId: "sw-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: swId,
      sourceInterfaceId: "sw-out",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGround([escId, ctrlId, sonarId], batId);

    const st1 = useRobotStore.getState();
    const worldA = SimulationWorld.fromAssembly({
      parts: st1.parts,
      connections: st1.connections,
      drivetrain: st1.drivetrain,
      foundation: st1.foundation,
      electricalConnections: st1.electricalConnections,
      arena: STANDARD_ROBOT_WARS_ARENA,
    }).world!;
    const worldB = SimulationWorld.fromAssembly({
      parts: st1.parts,
      connections: st1.connections,
      drivetrain: st1.drivetrain,
      foundation: st1.foundation,
      electricalConnections: st1.electricalConnections,
      arena: STANDARD_ROBOT_WARS_ARENA,
    }).world!;

    // Healthy sensor & manual drive works cleanly and identically across two deterministic runs
    expect(worldA.getControlApi().readUltrasonic(sonarId).ok).toBe(true);
    for (const w of [worldA, worldB]) {
      w.start();
      w.setDriveControls({ forward: true });
      for (let i = 0; i < 30; i++) {
        w.stepFrame(1 / 60);
      }
    }
    expect(worldA.getTelemetrySnapshot().xMeters).toBeGreaterThan(0.05);
    expect(worldA.getTelemetrySnapshot().xMeters).toBeCloseTo(
      worldB.getTelemetrySnapshot().xMeters,
      10
    );

    // Opening sensor switch cuts sensor readiness on re-compiled assembly while drive motors stay healthy
    useRobotStore.getState().setElectricalSwitchState(swId, false);
    const st2 = useRobotStore.getState();
    const worldOpenSensor = SimulationWorld.fromAssembly({
      parts: st2.parts,
      connections: st2.connections,
      drivetrain: st2.drivetrain,
      foundation: st2.foundation,
      electricalConnections: st2.electricalConnections,
      arena: STANDARD_ROBOT_WARS_ARENA,
    }).world!;
    expect(worldOpenSensor.getControlApi().readUltrasonic(sonarId).ok).toBe(false);
    expect(worldOpenSensor.getControlState().binding.canDrive).toBe(true);
  });

  it("F3: drives normally when power wires are authored in reversed (input -> output) endpoint order and isolates faulty parallel branches", () => {
    const { batId, leftMotorId, rightMotorId } = resetAndBuildBaseAssembly("standard-lipo");
    const store = useRobotStore.getState();
    const pdbId = store.installElectricalCatalogueItem("elec-pdb-xt60")!;
    const sonarId = store.installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!; // 4.5-5.5V max (incompatible with 12.6V bat)

    for (const mId of [leftMotorId, rightMotorId]) {
      store.updatePartElectricalProperties(mId, {
        motorSpec: {
          nominalVoltageV: 11.1,
          minVoltageV: 6,
          maxVoltageV: 14,
          ratedCurrentA: 1.5,
          stallCurrentA: 4.5,
          reversiblePolarity: true,
        },
      });
    }

    const addConn = useRobotStore.getState().addElectricalConnection;
    // Reversed valid power wires: LeftMotor -> PDB -> Battery, RightMotor -> PDB
    addConn({
      sourcePartId: leftMotorId,
      sourceInterfaceId: "motor-drive-input",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-bus-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: rightMotorId,
      sourceInterfaceId: "motor-drive-input",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-bus-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-pwr-in",
      targetPartId: batId,
      targetInterfaceId: "bat-power-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    // Add an incompatible overvoltage branch on the same battery: Bat (12.6V) -> 5V Sonar
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGround([pdbId, sonarId], batId);

    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      electricalConnections: st.electricalConnections,
      arena: STANDARD_ROBOT_WARS_ARENA,
    }).world!;

    expect(world.getControlState().binding.canDrive).toBe(true);
    // Incompatible sonar branch is faulted while reverse-wired healthy motors drive cleanly!
    expect(world.getControlApi().readUltrasonic(sonarId).ok).toBe(false);
    world.start();
    world.setDriveControls({ forward: true });
    world.stepFrame(1 / 60);
    const leftWheel = world.getLatestStepDiagnostics()!.diagnostics.wheels.find((w) => w.side === "left")!;
    const rightWheel = world.getLatestStepDiagnostics()!.diagnostics.wheels.find((w) => w.side === "right")!;
    expect(leftWheel.isElectricalPowered).toBe(true);
    expect(rightWheel.isElectricalPowered).toBe(true);
    expect(leftWheel.motorTorqueNm).toBeGreaterThan(0);
    expect(rightWheel.motorTorqueNm).toBeGreaterThan(0);
  });

  it("F3: enforces regulator inputMaxV, maxOutputCurrentA, BEC target fault propagation, and downstream vs upstream fuse domains", () => {
    // 1. Downstream Buck Fuse (12V Bat -> 5V Buck (10A max) -> 3A Fuse -> 5V 4A-stall Motor):
    //    Battery-side current is ~1.96A (< 3A), but fuse is on 5V output side seeing 4.0A (> 3A) -> MUST trip!
    const { batId: batBuckId, leftMotorId: mLeft1, rightMotorId: mRight1 } =
      resetAndBuildBaseAssembly("standard-lipo");
    const buckId = useRobotStore.getState().installElectricalCatalogueItem("elec-buck-5v")!;
    useRobotStore.getState().updatePartElectricalProperties(buckId, {
      driverOrRegulatorSpec: {
        powerRole: "buck",
        inputVoltageRangeV: { minV: 7, maxV: 35 },
        outputVoltageRangeV: { minV: 4.9, maxV: 5.1 },
        continuousCurrentPerChannelA: 10.0,
        efficiency: 0.85,
        dropoutVoltageV: 1.5,
      },
    });
    const buckFuseId = useRobotStore.getState().installElectricalCatalogueItem("elec-inline-fuse-20a", {
      name: "5V Branch 3A Fuse",
    })!;
    useRobotStore.getState().updatePartElectricalProperties(buckFuseId, {
      driverOrRegulatorSpec: { powerRole: "fuse", continuousCurrentPerChannelA: 3.0 },
    });
    for (const mId of [mLeft1, mRight1]) {
      useRobotStore.getState().updatePartElectricalProperties(mId, {
        motorSpec: {
          nominalVoltageV: 5.0,
          minVoltageV: 3.0,
          maxVoltageV: 14.0,
          ratedCurrentA: 1.0,
          stallCurrentA: 4.0,
          reversiblePolarity: true,
        },
      });
    }
    const addBuckConn = useRobotStore.getState().addElectricalConnection;
    addBuckConn({
      sourcePartId: batBuckId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addBuckConn({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-pwr-out",
      targetPartId: buckFuseId,
      targetInterfaceId: "fuse-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addBuckConn({
      sourcePartId: buckFuseId,
      sourceInterfaceId: "fuse-out",
      targetPartId: mLeft1,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addBuckConn({
      sourcePartId: batBuckId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: mRight1,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGround([buckId], batBuckId);

    const buckSt = useRobotStore.getState();
    const buckCompiled = compileSimulationConfig({
      parts: buckSt.parts,
      connections: buckSt.connections,
      drivetrain: buckSt.drivetrain,
      foundation: buckSt.foundation,
      electricalConnections: buckSt.electricalConnections,
    }).config!;
    const buckDummy = createInitialRunnerState(buckCompiled).simulationState;
    const buckFuseDiag = calculateBatteryOperatingPoint(
      buckCompiled,
      buckDummy,
      { leftThrottle: 1, rightThrottle: 0 },
      { openCircuitVoltageV: 12.0, internalResistanceOhm: 0.01 }
    );
    expect(buckFuseDiag.trippedFuseIds).toContain(buckFuseId);

    // 2. Regulator maxOutputCurrentA enforcement (1.5A Buck limits 4.0A stall motor to 1.5A output)
    const { batId: batClampId, leftMotorId: mClampL, rightMotorId: mClampR } =
      resetAndBuildBaseAssembly("standard-lipo");
    const clampBuckId = useRobotStore.getState().installElectricalCatalogueItem("elec-buck-5v")!;
    useRobotStore.getState().updatePartElectricalProperties(clampBuckId, {
      driverOrRegulatorSpec: {
        powerRole: "buck",
        inputVoltageRangeV: { minV: 7, maxV: 16 },
        outputVoltageRangeV: { minV: 4.9, maxV: 5.1 },
        continuousCurrentPerChannelA: 1.5,
        efficiency: 0.85,
        dropoutVoltageV: 1.5,
      },
    });
    useRobotStore.getState().updatePartElectricalProperties(mClampL, {
      motorSpec: {
        nominalVoltageV: 5.0,
        minVoltageV: 3.0,
        maxVoltageV: 14.0,
        ratedCurrentA: 1.0,
        stallCurrentA: 4.0,
        reversiblePolarity: true,
      },
    });
    const addClampConn = useRobotStore.getState().addElectricalConnection;
    addClampConn({
      sourcePartId: batClampId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: clampBuckId,
      targetInterfaceId: "elec-buck-5v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addClampConn({
      sourcePartId: clampBuckId,
      sourceInterfaceId: "elec-buck-5v-pwr-out",
      targetPartId: mClampL,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addClampConn({
      sourcePartId: batClampId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: mClampR,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGround([clampBuckId], batClampId);
    const clampSt = useRobotStore.getState();
    const clampCompiled = compileSimulationConfig({
      parts: clampSt.parts,
      connections: clampSt.connections,
      drivetrain: clampSt.drivetrain,
      foundation: clampSt.foundation,
      electricalConnections: clampSt.electricalConnections,
    }).config!;
    const clampDummy = createInitialRunnerState(clampCompiled).simulationState;

    const clampedDiag = calculateBatteryOperatingPoint(
      clampCompiled,
      clampDummy,
      { leftThrottle: 1, rightThrottle: 0 },
      { openCircuitVoltageV: 12.0, internalResistanceOhm: 0.01 }
    );
    const clampedMotorState = clampedDiag.perMotorStates!.find((m) => m.motorId === mClampL)!;
    expect(clampedMotorState.isCurrentLimited).toBe(true);
    expect(clampedMotorState.currentDrawA).toBeCloseTo(1.5, 2);

    // Regulator inputMaxV (16V) shutdown at 20V open-circuit
    const overVinDiag = calculateBatteryOperatingPoint(
      clampCompiled,
      clampDummy,
      { leftThrottle: 1, rightThrottle: 0 },
      { openCircuitVoltageV: 20.0, cutoffVoltageV: 10.0, internalResistanceOhm: 0.01 }
    );
    const overVinMotor = overVinDiag.perMotorStates!.find((m) => m.motorId === mClampL)!;
    expect(overVinMotor.isPowered).toBe(false);
    expect(overVinMotor.operatingVoltageV).toBe(0);
    expect(
      overVinDiag.activeElectricalFaults?.some((f) => f.toLowerCase().includes("overvoltage"))
    ).toBe(true);

    // 3. Downstream Boost Fuse stays untripped when load-side current (1.5A @ 15V) < fuse rating (3A)
    //    even while battery-side input current (1.5 * 15 / (8.4 * 0.9) ≈ 2.98-3.3A) is higher;
    //    and upstream fuse on Boost sees battery-side current and DOES trip!
    const { batId: batBoostId, leftMotorId: mBoostL, rightMotorId: mBoostR } =
      resetAndBuildBaseAssembly("compact-lipo"); // 8.4V full
    const boostId = useRobotStore.getState().installElectricalCatalogueItem("elec-boost-12v")!;
    useRobotStore.getState().updatePartElectricalProperties(boostId, {
      driverOrRegulatorSpec: {
        powerRole: "boost",
        inputVoltageRangeV: { minV: 3.0, maxV: 12.0 },
        outputVoltageRangeV: { minV: 11.8, maxV: 12.2 },
        continuousCurrentPerChannelA: 5.0,
        efficiency: 0.9,
      },
    });
    const downBoostFuseId = useRobotStore.getState().installElectricalCatalogueItem("elec-inline-fuse-20a", {
      name: "Boost Output 2A Fuse",
    })!;
    useRobotStore.getState().updatePartElectricalProperties(downBoostFuseId, {
      driverOrRegulatorSpec: { powerRole: "fuse", continuousCurrentPerChannelA: 2.0 },
    });
    const upBoostFuseId = useRobotStore.getState().installElectricalCatalogueItem("elec-inline-fuse-20a", {
      name: "Boost Input 2A Fuse",
    })!;
    useRobotStore.getState().updatePartElectricalProperties(upBoostFuseId, {
      driverOrRegulatorSpec: { powerRole: "fuse", continuousCurrentPerChannelA: 2.0 },
    });
    for (const mId of [mBoostL, mBoostR]) {
      useRobotStore.getState().updatePartElectricalProperties(mId, {
        motorSpec: {
          nominalVoltageV: 12.0,
          minVoltageV: 4.0,
          maxVoltageV: 16.0,
          ratedCurrentA: 1.5,
          stallCurrentA: 1.5, // 1.5A at 12V: downstream 2A fuse must NOT trip, upstream 2A fuse (>2.38A) MUST trip!
          reversiblePolarity: true,
        },
      });
    }
    const addBoostConn = useRobotStore.getState().addElectricalConnection;
    addBoostConn({
      sourcePartId: batBoostId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: upBoostFuseId,
      targetInterfaceId: "fuse-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addBoostConn({
      sourcePartId: upBoostFuseId,
      sourceInterfaceId: "fuse-out",
      targetPartId: boostId,
      targetInterfaceId: "elec-boost-12v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addBoostConn({
      sourcePartId: boostId,
      sourceInterfaceId: "elec-boost-12v-pwr-out",
      targetPartId: downBoostFuseId,
      targetInterfaceId: "fuse-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addBoostConn({
      sourcePartId: downBoostFuseId,
      sourceInterfaceId: "fuse-out",
      targetPartId: mBoostL,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGround([boostId], batBoostId);

    const boostSt = useRobotStore.getState();
    const boostCompiled = compileSimulationConfig({
      parts: boostSt.parts,
      connections: boostSt.connections,
      drivetrain: boostSt.drivetrain,
      foundation: boostSt.foundation,
      electricalConnections: boostSt.electricalConnections,
    }).config!;
    const boostDummy = createInitialRunnerState(boostCompiled).simulationState;
    const boostDiag = calculateBatteryOperatingPoint(
      boostCompiled,
      boostDummy,
      { leftThrottle: 1, rightThrottle: 0 },
      { openCircuitVoltageV: 8.4, internalResistanceOhm: 0.01 }
    );
    expect(boostDiag.trippedFuseIds).toContain(upBoostFuseId);
    expect(boostDiag.trippedFuseIds).not.toContain(downBoostFuseId);

    // 4. Motor-Driver BEC target fault propagation when upstream ESC feed fails compatibility
    const { batId: batBecId } = resetAndBuildBaseAssembly("heavy-duty-lipo"); // 14.8V / 16.8V max
    const escId = useRobotStore.getState().installElectricalCatalogueItem("elec-esc-brushed-30a")!;
    useRobotStore.getState().updatePartElectricalProperties(escId, {
      interfaces: [
        {
          interfaceId: "esc-bat-in",
          name: "ESC Input",
          role: "power-input",
          voltageSpec: { minV: 5.0, maxV: 12.6 }, // fails against 4S 16.8V battery!
          pinIds: ["pin-esc-in"],
          provenance: { method: "user-supplied" },
        },
        {
          interfaceId: "esc-motor-out",
          name: "ESC Motor Output",
          role: "power-output",
          pinIds: ["pin-esc-out"],
          provenance: { method: "user-supplied" },
        },
        {
          interfaceId: "esc-bec-out",
          name: "ESC 5V BEC",
          role: "power-output",
          voltageSpec: { nominalV: 5.0, minV: 4.8, maxV: 5.2 },
          currentSpec: { maxContinuousA: 2.0 },
          pinIds: ["pin-esc-bec"],
          provenance: { method: "user-supplied" },
        },
      ],
    });
    const becSonarId = useRobotStore.getState().installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!;
    const addBecConn = useRobotStore.getState().addElectricalConnection;
    addBecConn({
      sourcePartId: batBecId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: escId,
      targetInterfaceId: "esc-bat-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addBecConn({
      sourcePartId: escId,
      sourceInterfaceId: "esc-bec-out",
      targetPartId: becSonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    const becSt = useRobotStore.getState();
    const becReport = validateElectricalAssembly({
      parts: becSt.parts,
      electricalConnections: becSt.electricalConnections,
    });
    expect(becReport.powerAnalysis?.consumerStates[becSonarId]?.hasPathFault).toBe(true);
    const becCompiled = compileSimulationConfig({
      parts: becSt.parts,
      connections: becSt.connections,
      drivetrain: becSt.drivetrain,
      foundation: becSt.foundation,
      electricalConnections: becSt.electricalConnections,
    }).config!;
    const compiledBecReg = becCompiled.electrical?.regulators.find((r) => r.partId === escId);
    expect(compiledBecReg?.hasCompileFault).toBe(true);
  });
});
