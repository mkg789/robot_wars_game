import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { BUILTIN_CONTROL_ROUTINES } from "../data/builtInPrograms";
import {
  applyCommandToDriveTarget,
  NEUTRAL_NORMALIZED_TARGET,
  normalizeCommandPower,
  resolveRobotHardwareBinding,
} from "./controlCommandPipeline";
import { SimulationWorld } from "../../simulation/logic/simulationWorld";

function buildStandardDrivableAssembly() {
  const store = useRobotStore.getState();
  store.startNewBuild();
  store.confirmFoundation();
  store.installBattery("standard-lipo");
  store.installController("arduino-uno");

  store.selectMotorCatalogueItem("standard-dc");
  store.selectMountZone("front-left");
  store.placeMotor();
  store.selectMountZone("front-right");
  store.placeMotor();

  const afterMotors = useRobotStore.getState();
  const leftMotor = afterMotors.parts.find(
    (p) => p.type === "Motor" && p.mountingZoneId === "front-left"
  )!;
  const rightMotor = afterMotors.parts.find(
    (p) => p.type === "Motor" && p.mountingZoneId === "front-right"
  )!;

  afterMotors.selectWheelCatalogueItem("standard-rubber");
  afterMotors.assignWheel(leftMotor.id);
  useRobotStore.getState().assignWheel(rightMotor.id);
  useRobotStore.getState().applySuggestedDrivetrainMapping(true);

  return {
    leftMotorId: leftMotor.id,
    rightMotorId: rightMotor.id,
  };
}

describe("Phase 6.0: Robot Programming & Control Foundation", () => {
  beforeEach(() => {
    buildStandardDrivableAssembly();
  });

  it("normalizes, bounds, and validates actuator commands cleanly", () => {
    expect(normalizeCommandPower(1.8)).toMatchObject({ value: 1, clamped: true });
    expect(normalizeCommandPower(-2.5)).toMatchObject({ value: -1, clamped: true });
    expect(normalizeCommandPower(Number.NaN)).toMatchObject({
      value: 0,
      clamped: true,
    });
    expect(normalizeCommandPower(1e-9)).toMatchObject({ value: 0, clamped: false });

    const binding = {
      leftMotorIds: ["m-l"],
      rightMotorIds: [],
      hasLeftMotors: true,
      hasRightMotors: false,
      canDrive: true,
      electricalMode: "mechanical-only" as const,
      warnings: [],
    };

    // Targeting missing right motor warns & leaves right channel safely at 0
    const rightStep = applyCommandToDriveTarget({
      current: NEUTRAL_NORMALIZED_TARGET,
      command: { kind: "set-motor-power", target: "right", power: 0.9 },
      binding,
      timestampSeconds: 0.1,
    });
    expect(rightStep.drivetrainInput.rightThrottle).toBe(0);
    expect(rightStep.result.warnings.length).toBeGreaterThan(0);

    // Valid left command sets normalized throttle, then stopMotors clears only left
    const leftStep = applyCommandToDriveTarget({
      current: NEUTRAL_NORMALIZED_TARGET,
      command: { kind: "set-motor-power", target: "left", power: 0.75 },
      binding,
      timestampSeconds: 0.2,
    });
    expect(leftStep.drivetrainInput.leftThrottle).toBe(0.75);

    const stopped = applyCommandToDriveTarget({
      current: leftStep.nextTarget,
      command: { kind: "stop-robot" },
      binding,
      timestampSeconds: 0.3,
    });
    expect(stopped.drivetrainInput).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("executes control commands and built-in routines through SimulationWorld physics without bypassing drivetrain or battery dynamics", () => {
    const state = useRobotStore.getState();
    const init = SimulationWorld.fromAssembly({
      parts: state.parts,
      connections: state.connections,
      drivetrain: state.drivetrain,
      foundation: state.foundation,
      electricalConnections: state.electricalConnections,
    });
    expect(init.success).toBe(true);
    const world = init.world!;

    const forwardRoutine = BUILTIN_CONTROL_ROUTINES.find(
      (r) => r.id === "program-forward-pulse"
    )!;
    world.setProgramRoutine(forwardRoutine);
    expect(world.startProgram()).toBe(true);

    // Step simulation while program runs (< 2.5s) -> battery drains, robot translates forward
    for (let i = 0; i < 60; i++) {
      world.stepFrame(1 / 60);
    }
    const midTelemetry = world.getTelemetrySnapshot();
    const midControl = world.getControlState();
    expect(midControl.controlSource).toBe("program");
    expect(midControl.programStatus).toBe("running");
    expect(midControl.leftPower).toBeCloseTo(0.65, 2);
    expect(midTelemetry.xMeters).toBeGreaterThan(0.1);
    expect(midTelemetry.totalCurrentDrawA).toBeGreaterThan(0);

    // Advance past 2.5s -> routine calls completeProgram() -> stops robot motors
    for (let i = 0; i < 120; i++) {
      world.stepFrame(1 / 60);
    }
    const endControl = world.getControlState();
    expect(endControl.programStatus).toBe("completed");
    expect(endControl.leftPower).toBe(0);
    expect(endControl.rightPower).toBe(0);

    // Direct API control + differential steering
    world.start();
    const apiRes = world.getControlApi().setDifferentialPower(0.8, -0.4);
    expect(apiRes.accepted).toBe(true);
    world.stepFrame(1 / 60);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0.8, rightThrottle: -0.4 });

    // Switching back to manual controls overrides smoothly and resets program status
    world.setDriveControls({ forward: true });
    expect(world.getControlState().controlSource).toBe("manual");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 1, rightThrottle: 1 });

    // Reset clears program & inputs cleanly
    world.reset();
    expect(world.getControlState().programStatus).toBe("idle");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("isolates throwing user program faults cleanly without crashing SimulationWorld", () => {
    const state = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: state.parts,
      connections: state.connections,
      drivetrain: state.drivetrain,
      foundation: state.foundation,
    }).world!;

    world.setProgramRoutine({
      id: "faulting-routine",
      name: "Faulting Test",
      description: "Throws after 0.05s",
      onTick: (ctx, api) => {
        if (ctx.timeSeconds >= 0.05) {
          throw new Error("Simulated user script division fault");
        }
        api.setMotorPower("both", 0.9);
      },
    });
    world.startProgram();

    for (let i = 0; i < 10; i++) {
      world.stepFrame(1 / 60);
    }
    const ctrlState = world.getControlState();
    expect(ctrlState.programStatus).toBe("fault");
    expect(ctrlState.lastError).toContain("Simulated user script division fault");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("respects electrical validation and gates motor actuation when wired drive motors have electrical faults", () => {
    const { leftMotorId } = buildStandardDrivableAssembly();

    // Wire an unfed PDB -> leftMotor (so leftMotor is electrically unpowered!)
    const pdbId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-pdb-xt60")!;
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: leftMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    const state = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: state.parts,
      connections: state.connections,
      drivetrain: state.drivetrain,
      foundation: state.foundation,
      electricalConnections: state.electricalConnections,
    }).world!;

    const binding = resolveRobotHardwareBinding({
      robotConfig: world.getRobotConfig(),
      parts: state.parts,
      electricalConnections: state.electricalConnections,
    });
    expect(binding.electricalMode).toBe("electrical-fault");
    expect(binding.canDrive).toBe(false);

    // Command attempts are safely blocked cleanly when hardware has an active electrical fault
    const blocked = world.setMotorPower("both", 1.0);
    expect(blocked.accepted).toBe(false);
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
  });

  it("enforces consistent motor readiness when electrical wiring exists without letting unrelated sensor errors block healthy wired drive motors", () => {
    const { leftMotorId, rightMotorId } = buildStandardDrivableAssembly();
    const st0 = useRobotStore.getState();
    const batId = st0.parts.find((p) => p.type === "Battery")!.id;
    const sonarId = st0.installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!;
    const pdbId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-pdb-xt60")!;

    const addConn = useRobotStore.getState().addElectricalConnection;
    // Wire Battery -> PDB -> both Drive Motors, leaving unrelated 5V Sonar directly wired to 11.1V PDB (sensor overvoltage!)
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    for (const mId of [leftMotorId, rightMotorId]) {
      addConn({
        sourcePartId: pdbId,
        sourceInterfaceId: "pdb-bus-out",
        targetPartId: mId,
        targetInterfaceId: "motor-drive-input",
        connectionType: "power",
        provenance: { method: "user-supplied" },
      });
    }
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    const st1 = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st1.parts,
      connections: st1.connections,
      drivetrain: st1.drivetrain,
      foundation: st1.foundation,
      electricalConnections: st1.electricalConnections,
    }).world!;

    const isolatedBinding = resolveRobotHardwareBinding({
      robotConfig: world.getRobotConfig(),
      parts: st1.parts,
      electricalConnections: st1.electricalConnections,
    });
    // Wired drive motors stay operational even when an unrelated sensor branch has an overvoltage fault
    expect(isolatedBinding.canDrive).toBe(true);
    // While the overvolted sonar itself stays gated unavailable
    expect(world.getControlApi().readUltrasonic(sonarId).ok).toBe(false);

    // If only a controller/sensor is wired leaving drive motors unwired, motor readiness rejects unwired motors consistently with sensors
    const { leftMotorId: unwiredLeft } = buildStandardDrivableAssembly();
    void unwiredLeft;
    const bat2 = useRobotStore.getState().parts.find((p) => p.type === "Battery")!.id;
    const ctrl2 = useRobotStore.getState().parts.find((p) => p.type === "Controller")!.id;
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: bat2,
      sourceInterfaceId: "bat-power-out",
      targetPartId: ctrl2,
      targetInterfaceId: "ctrl-power-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    const st2 = useRobotStore.getState();
    const unwiredBinding = resolveRobotHardwareBinding({
      robotConfig: world.getRobotConfig(),
      parts: st2.parts,
      electricalConnections: st2.electricalConnections,
    });
    expect(unwiredBinding.canDrive).toBe(false);
    expect(unwiredBinding.electricalMode).toBe("electrical-fault");
  });
});
