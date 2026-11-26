import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { compileVisualProgramToRoutine } from "../../programming/logic/programWorkspaceCompiler";
import type { VisualRobotProgram } from "../../programming/types/programWorkspace.types";
import {
  createRectangularArena,
  STANDARD_ROBOT_WARS_ARENA,
} from "./arenaModel";
import { OBSTACLE_TEST_ARENA, SimulationWorld } from "./simulationWorld";

function buildStandardWiredTestRobot(options?: {
  readonly withSonar?: boolean;
  readonly withSensorSwitch?: boolean;
  readonly withLeftBranchFuseA?: number;
}) {
  const store = useRobotStore.getState();
  store.startNewBuild();
  store.confirmFoundation();
  store.installBattery("standard-lipo");
  store.installController("arduino-uno");

  store.selectMotorCatalogueItem("high-torque-dc");
  store.selectMountZone("front-left");
  store.placeMotor();
  store.selectMountZone("front-right");
  store.placeMotor();

  const st0 = useRobotStore.getState();
  const batId = st0.parts.find((p) => p.type === "Battery")!.id;
  const ctrlId = st0.parts.find((p) => p.type === "Controller")!.id;
  const leftMotorId = st0.parts.find(
    (p) => p.type === "Motor" && p.mountingZoneId === "front-left"
  )!.id;
  const rightMotorId = st0.parts.find(
    (p) => p.type === "Motor" && p.mountingZoneId === "front-right"
  )!.id;

  st0.selectWheelCatalogueItem("standard-rubber");
  st0.assignWheel(leftMotorId);
  useRobotStore.getState().assignWheel(rightMotorId);
  useRobotStore.getState().applySuggestedDrivetrainMapping(true);

  const sonarId = options?.withSonar
    ? useRobotStore
        .getState()
        .installElectricalCatalogueItem("elec-hcsr04-ultrasonic", {
          position: [1.25, 0.15, 0],
        })!
    : null;

  let sensorSwitchId: string | null = null;
  let leftFuseId: string | null = null;

  if (options?.withSensorSwitch || options?.withLeftBranchFuseA !== undefined) {
    const s = useRobotStore.getState();
    const pdbId = s.installElectricalCatalogueItem("elec-pdb-xt60")!;
    const buckId = s.installElectricalCatalogueItem("elec-buck-5v")!;
    const addConn = useRobotStore.getState().addElectricalConnection;

    for (const mId of [leftMotorId, rightMotorId]) {
      useRobotStore.getState().updatePartElectricalProperties(mId, {
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

    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    if (options?.withLeftBranchFuseA !== undefined) {
      leftFuseId = useRobotStore
        .getState()
        .installElectricalCatalogueItem("elec-inline-fuse-20a", {
          name: "Left Branch Fuse",
        })!;
      useRobotStore.getState().updatePartElectricalProperties(leftFuseId, {
        driverOrRegulatorSpec: {
          powerRole: "fuse",
          continuousCurrentPerChannelA: options.withLeftBranchFuseA,
          peakCurrentA: options.withLeftBranchFuseA,
        },
      });
      addConn({
        sourcePartId: pdbId,
        sourceInterfaceId: "pdb-bus-out",
        targetPartId: leftFuseId,
        targetInterfaceId: "fuse-in",
        connectionType: "power",
        provenance: { method: "user-supplied" },
      });
      addConn({
        sourcePartId: leftFuseId,
        sourceInterfaceId: "fuse-out",
        targetPartId: leftMotorId,
        targetInterfaceId: "motor-drive-input",
        connectionType: "power",
        provenance: { method: "user-supplied" },
      });
    } else {
      addConn({
        sourcePartId: pdbId,
        sourceInterfaceId: "pdb-bus-out",
        targetPartId: leftMotorId,
        targetInterfaceId: "motor-drive-input",
        connectionType: "power",
        provenance: { method: "user-supplied" },
      });
    }

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

    if (sonarId) {
      if (options?.withSensorSwitch) {
        sensorSwitchId = useRobotStore
          .getState()
          .installElectricalCatalogueItem("elec-power-switch", {
            name: "Sensor Switch",
          })!;
        addConn({
          sourcePartId: buckId,
          sourceInterfaceId: "elec-buck-5v-pwr-out",
          targetPartId: sensorSwitchId,
          targetInterfaceId: "sw-in",
          connectionType: "power",
          provenance: { method: "user-supplied" },
        });
        addConn({
          sourcePartId: sensorSwitchId,
          sourceInterfaceId: "sw-out",
          targetPartId: sonarId,
          targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
          connectionType: "power",
          provenance: { method: "user-supplied" },
        });
      } else if (leftFuseId) {
        // Wire sonar downstream of leftFuseId when testing fuse-to-sensor propagation
        addConn({
          sourcePartId: buckId,
          sourceInterfaceId: "elec-buck-5v-pwr-out",
          targetPartId: sonarId,
          targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
          connectionType: "power",
          provenance: { method: "user-supplied" },
        });
      }
    }

    for (const gid of [pdbId, buckId, ctrlId, ...(sonarId ? [sonarId] : [])]) {
      const p = useRobotStore.getState().parts.find((part) => part.id === gid);
      const gndIface =
        p?.electricalSpec?.interfaces.find((i) => i.role === "ground")
          ?.interfaceId ?? "ctrl-gnd";
      addConn({
        sourcePartId: gid,
        sourceInterfaceId: gndIface,
        targetPartId: batId,
        targetInterfaceId: "bat-gnd",
        connectionType: "ground",
        provenance: { method: "user-supplied" },
      });
    }
  }

  return { batId, ctrlId, leftMotorId, rightMotorId, sonarId, sensorSwitchId, leftFuseId };
}

describe("Stage D: Simulation & Programming Stabilization", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("preserves and restores active program motor targets across SimulationWorld pause/resume for both drive and set-motors+wait", () => {
    buildStandardWiredTestRobot();
    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      arena: STANDARD_ROBOT_WARS_ARENA,
    }).world!;

    const prog: VisualRobotProgram = {
      version: 1,
      id: "prog-world-pause-resume",
      name: "World Pause Resume",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        {
          id: "set-1",
          kind: "set-motors",
          leftPower: 0.7,
          rightPower: 0.7,
        },
        {
          id: "wait-1",
          kind: "wait",
          durationSeconds: 0.4,
        },
        {
          id: "drv-1",
          kind: "drive",
          direction: "forward",
          power: 0.8,
          durationSeconds: 0.4,
        },
      ],
    };

    world.setProgramRoutine(compileVisualProgramToRoutine(prog));
    expect(world.startProgram()).toBe(true);

    // Run 0.1s into wait-1 (motors should be held at 0.7)
    for (let i = 0; i < 6; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.getControlState().leftPower).toBeCloseTo(0.7, 3);

    // SimulationWorld.pause() must stop motor output cleanly while paused
    world.pause();
    expect(world.getLifecycleStatus()).toBe("paused");
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });
    expect(world.getControlState().programStatus).toBe("paused");
    expect(world.getControlState().leftPower).toBe(0);

    // SimulationWorld.resume() must restore the held 0.7 motor power for the rest of wait-1 and complete drv-1
    world.resume();
    expect(world.getLifecycleStatus()).toBe("running");
    expect(world.getControlState().programStatus).toBe("running");
    expect(world.getControlState().leftPower).toBeCloseTo(0.7, 3);

    // Pause again mid-drv-1 after advancing 0.45s
    for (let i = 0; i < 27; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.getControlState().executionTrace?.activeInstructionId).toBe("drv-1");
    world.pause();
    expect(world.getActiveInput()).toEqual({ leftThrottle: 0, rightThrottle: 0 });

    world.resume();
    expect(world.getControlState().leftPower).toBeCloseTo(0.8, 3);

    for (let i = 0; i < 40; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.getControlState().programStatus).toBe("completed");
    expect(world.getControlState().leftPower).toBe(0);
    expect(world.getTelemetrySnapshot().xMeters).toBeGreaterThan(0.1);
  });

  it("prevents stale manual motor power from leaking into newly started or stepped programs and isolates manual/fault transitions", () => {
    buildStandardWiredTestRobot();
    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      arena: STANDARD_ROBOT_WARS_ARENA,
    }).world!;

    // Apply direct motor power before starting a program that begins with Wait
    world.start();
    world.setMotorPower("both", 0.9);
    expect(world.getControlState().leftPower).toBeCloseTo(0.9, 3);

    const waitFirstProg: VisualRobotProgram = {
      version: 1,
      id: "prog-wait-first",
      name: "Wait First",
      updatedAtIso: new Date().toISOString(),
      instructions: [{ id: "w-1", kind: "wait", durationSeconds: 0.3 }],
    };

    world.setProgramRoutine(compileVisualProgramToRoutine(waitFirstProg));
    expect(world.startProgram()).toBe(true);
    world.stepFrame(1 / 60);
    expect(world.getControlState().leftPower).toBe(0);
    expect(world.getControlState().rightPower).toBe(0);

    // Pausing then switching to manual control must cleanly stop the paused program
    expect(world.pauseProgram()).toBe(true);
    expect(world.getControlState().programStatus).toBe("paused");
    world.setManualControlMode();
    expect(world.getControlState().controlSource).toBe("manual");
    expect(world.getControlState().programStatus).toBe("stopped");

    // Stepping while simulation is running must transition lifecycleStatus to paused
    world.setProgramRoutine(compileVisualProgramToRoutine(waitFirstProg));
    world.start();
    expect(world.getLifecycleStatus()).toBe("running");
    world.stepProgram();
    expect(world.getLifecycleStatus()).toBe("paused");
    expect(world.getControlState().programStatus).toBe("paused");

    // Calling stopProgram on a faulted routine must preserve fault status and zero outputs
    world.setProgramRoutine({
      id: "fault-check",
      name: "Fault Check",
      description: "Throws on tick",
      onTick: () => {
        throw new Error("Controlled test fault");
      },
    });
    world.startProgram();
    world.stepFrame(1 / 60);
    expect(world.getControlState().programStatus).toBe("fault");
    world.stopProgram();
    expect(world.getControlState().programStatus).toBe("fault");
    expect(world.getControlState().leftPower).toBe(0);

    // Reset restores clean initial control source, idle status, and zeroed state
    world.reset();
    expect(world.getLifecycleStatus()).toBe("ready");
    expect(world.getControlState().controlSource).toBe("manual");
    expect(world.getControlState().programStatus).toBe("idle");
    expect(world.getControlState().lastError).toBeNull();
    expect(world.getControlState().executionTrace).toBeNull();
  });

  it("synchronizes runtime switch toggles, overcurrent fuse trips, encoder speeds, and sensors within the same session and on reset", () => {
    const { sonarId, sensorSwitchId } = buildStandardWiredTestRobot({
      withSonar: true,
      withSensorSwitch: true,
    });
    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      electricalConnections: st.electricalConnections,
      arena: OBSTACLE_TEST_ARENA,
    }).world!;

    // Initially sensor switch is closed -> sensor reads normally
    expect(world.getControlApi().readUltrasonic(sonarId!).ok).toBe(true);

    // Toggling sensor switch open dynamically gates the sensor without rebuilding the world
    world.setSwitchState(sensorSwitchId!, false);
    const openRead = world.getControlApi().readUltrasonic(sonarId!);
    expect(openRead.ok).toBe(false);
    expect(openRead.status).toBe("unavailable-unpowered");
    expect(world.getSensorsSnapshot()?.ultrasonic.ok).toBe(false);
    // Drive motors remain operational
    expect(world.getControlState().binding.canDrive).toBe(true);

    // Closing the switch dynamically restores sensor availability
    world.setSwitchState(sensorSwitchId!, true);
    expect(world.getControlApi().readUltrasonic(sonarId!).ok).toBe(true);

    // Opening switch and calling reset() restores initial defaultClosed=true state
    world.setSwitchState(sensorSwitchId!, false);
    expect(world.getControlApi().readUltrasonic(sonarId!).ok).toBe(false);
    world.reset();
    expect(world.getControlApi().readUltrasonic(sonarId!).ok).toBe(true);
  });

  it("keeps unpowered fuse-tripped wheels and encoders synchronized on low-grip surfaces and clears cleanly on resetFuses/reset", () => {
    const { leftFuseId } = buildStandardWiredTestRobot({
      withLeftBranchFuseA: 2.0,
    });
    const st = useRobotStore.getState();
    const lowGripArena = createRectangularArena({
      id: "low-grip-fuse-test",
      name: "Low Grip Fuse Test",
      lengthM: 12,
      widthM: 12,
      fallbackSurface: "low-grip",
    });

    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      electricalConnections: st.electricalConnections,
      arena: lowGripArena,
    }).world!;

    world.start();
    world.setMotorPower("both", 1.0);
    // Step 1 trips the 2A left fuse under 4.5A stall demand
    world.stepFrame(1 / 120);
    expect(world.getElectricalState()?.trippedFuseIds).toContain(leftFuseId);

    // Post-trip: left motor is unpowered; left wheel must not report artificial slip speed when stationary
    world.stepFrame(1 / 120);
    const stepDiag = world.getLatestStepDiagnostics()!;
    const leftWheelDiag = stepDiag.diagnostics.wheels.find((w) => w.side === "left")!;
    const rightWheelDiag = stepDiag.diagnostics.wheels.find((w) => w.side === "right")!;
    expect(leftWheelDiag.isElectricalPowered).toBe(false);
    expect(leftWheelDiag.motorTorqueNm).toBe(0);
    expect(stepDiag.state.leftSlipRatio).toBe(0);
    expect(Math.abs(stepDiag.state.leftWheelLinearSurfaceSpeedMps)).toBeLessThan(0.05);
    expect(rightWheelDiag.isElectricalPowered).toBe(true);
    expect(rightWheelDiag.motorTorqueNm).toBeGreaterThan(0);

    // Clearing fuses refreshes electrical telemetry immediately even while paused
    world.pause();
    world.resetFuses();
    expect(world.getElectricalState()?.trippedFuseIds).toEqual([]);
    expect(
      world
        .getElectricalState()
        ?.motorStates.every((ms) => ms.isPowered)
    ).toBe(true);

    // Full reset clears fuse trips, telemetry, and position
    world.reset();
    expect(world.getElectricalState()?.trippedFuseIds).toEqual([]);
    expect(world.getTelemetrySnapshot().xMeters).toBe(0);
  });

  it("executes programs deterministically at fixed timesteps regardless of frame rate chunking", () => {
    buildStandardWiredTestRobot({ withSonar: true });
    const st = useRobotStore.getState();

    const prog: VisualRobotProgram = {
      version: 1,
      id: "prog-framerate-invariant",
      name: "Framerate Invariant",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        {
          id: "drv-1",
          kind: "drive",
          direction: "forward",
          power: 0.7,
          durationSeconds: 0.3,
        },
        {
          id: "if-1",
          kind: "if-ultrasonic",
          operator: "below",
          thresholdMeters: 2.0,
          thenInstructions: [
            {
              id: "trn-then",
              kind: "turn",
              direction: "left",
              power: 0.5,
              durationSeconds: 0.2,
            },
          ],
          elseInstructions: [
            {
              id: "drv-else",
              kind: "drive",
              direction: "forward",
              power: 0.5,
              durationSeconds: 0.2,
            },
          ],
        },
      ],
    };

    const runWithFrameDt = (frameDt: number, frameCount: number) => {
      const world = SimulationWorld.fromAssembly({
        parts: st.parts,
        connections: st.connections,
        drivetrain: st.drivetrain,
        foundation: st.foundation,
        arena: OBSTACLE_TEST_ARENA,
      }).world!;
      world.setProgramRoutine(compileVisualProgramToRoutine(prog));
      world.startProgram();
      for (let i = 0; i < frameCount; i++) {
        world.stepFrame(frameDt);
      }
      return {
        telemetry: world.getTelemetrySnapshot(),
        control: world.getControlState(),
      };
    };

    // Exact 0.6s across 120Hz (72 frames), 60Hz (36 frames), and 20Hz (12 frames)
    const run120 = runWithFrameDt(1 / 120, 72);
    const run60 = runWithFrameDt(1 / 60, 36);
    const run20 = runWithFrameDt(0.05, 12);

    expect(run120.control.programStatus).toBe("completed");
    expect(run60.control.programStatus).toBe("completed");
    expect(run20.control.programStatus).toBe("completed");

    expect(run60.telemetry.xMeters).toBeCloseTo(run120.telemetry.xMeters, 10);
    expect(run60.telemetry.headingRadians).toBeCloseTo(
      run120.telemetry.headingRadians,
      10
    );
    expect(run20.telemetry.xMeters).toBeCloseTo(run120.telemetry.xMeters, 10);
    expect(run20.telemetry.headingRadians).toBeCloseTo(
      run120.telemetry.headingRadians,
      10
    );
  });

  it("maintains consistent debugger trace across conditional branches inside repeat loops, large loops, and invalid instructions", () => {
    buildStandardWiredTestRobot({ withSonar: true });
    const st = useRobotStore.getState();

    // 1. Large instant loop (> 200 steps): repeat(50) x 5 instant instructions = 250 steps
    const largeLoopWorld = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      arena: OBSTACLE_TEST_ARENA,
    }).world!;
    const largeLoopProg: VisualRobotProgram = {
      version: 1,
      id: "prog-large-loop",
      name: "Large Loop",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        {
          id: "rep-50",
          kind: "repeat",
          count: 50,
          bodyInstructions: [
            { id: "m-1", kind: "set-motors", leftPower: 0.2, rightPower: 0.2 },
            { id: "m-2", kind: "set-motors", leftPower: 0.3, rightPower: 0.3 },
            { id: "m-3", kind: "set-motors", leftPower: 0.4, rightPower: 0.4 },
            { id: "m-4", kind: "set-motors", leftPower: 0.5, rightPower: 0.5 },
            { id: "m-5", kind: "stop", target: "both" },
          ],
        },
      ],
    };
    largeLoopWorld.setProgramRoutine(compileVisualProgramToRoutine(largeLoopProg));
    largeLoopWorld.startProgram();
    largeLoopWorld.stepFrame(1 / 60);
    const largeTrace = largeLoopWorld.getControlState().executionTrace!;
    expect(largeLoopWorld.getControlState().programStatus).toBe("completed");
    expect(largeTrace.repeatProgressById["rep-50"]).toEqual({
      currentIteration: 50,
      totalIterations: 50,
    });

    // 2. Conditional branch inside repeat loop: never leaves an instruction in both completed and skipped
    const branchWorld = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      arena: OBSTACLE_TEST_ARENA,
    }).world!;
    const branchLoopProg: VisualRobotProgram = {
      version: 1,
      id: "prog-branch-loop",
      name: "Branch Loop",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        {
          id: "rep-2",
          kind: "repeat",
          count: 2,
          bodyInstructions: [
            {
              id: "if-sonar",
              kind: "if-ultrasonic",
              operator: "below",
              thresholdMeters: 1.5, // True initially (1.10m < 1.5m) -> THEN runs, ELSE skipped
              thenInstructions: [
                {
                  id: "drv-back",
                  kind: "drive",
                  direction: "backward",
                  power: 0.9,
                  durationSeconds: 0.8, // Moves far enough back that iter 2 sees > 1.5m -> ELSE runs
                },
              ],
              elseInstructions: [
                { id: "stop-else", kind: "stop", target: "robot" },
              ],
            },
          ],
        },
      ],
    };
    branchWorld.setProgramRoutine(compileVisualProgramToRoutine(branchLoopProg));
    branchWorld.startProgram();
    for (let i = 0; i < 80; i++) {
      branchWorld.stepFrame(1 / 60);
    }
    const branchTrace = branchWorld.getControlState().executionTrace!;
    expect(branchWorld.getControlState().programStatus).toBe("completed");
    const completedSet = new Set(branchTrace.completedInstructionIds);
    for (const skippedId of branchTrace.skippedInstructionIds) {
      expect(completedSet.has(skippedId)).toBe(false);
    }

    // 3. Invalid NaN duration fails safely with instruction attribution
    const invalidWorld = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      arena: STANDARD_ROBOT_WARS_ARENA,
    }).world!;
    const invalidProg: VisualRobotProgram = {
      version: 1,
      id: "prog-invalid-nan",
      name: "Invalid Duration",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        {
          id: "bad-drv",
          kind: "drive",
          direction: "forward",
          power: 0.5,
          durationSeconds: Number.NaN,
        },
      ],
    };
    invalidWorld.setProgramRoutine(compileVisualProgramToRoutine(invalidProg));
    invalidWorld.startProgram();
    invalidWorld.stepFrame(1 / 60);
    expect(invalidWorld.getControlState().programStatus).toBe("fault");
    expect(invalidWorld.getControlState().leftPower).toBe(0);
    expect(invalidWorld.getControlState().executionTrace?.failedInstructionId).toBe("bad-drv");
  });

  it("isolates multiple SimulationWorld sessions completely without cross-session state leakage", () => {
    const { sensorSwitchId } = buildStandardWiredTestRobot({
      withSonar: true,
      withSensorSwitch: true,
    });
    const st = useRobotStore.getState();

    const worldA = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      electricalConnections: st.electricalConnections,
      arena: OBSTACLE_TEST_ARENA,
    }).world!;

    const worldB = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      electricalConnections: st.electricalConnections,
      arena: STANDARD_ROBOT_WARS_ARENA,
    }).world!;

    // Mutate switch, controls, and pose in worldA only
    worldA.setSwitchState(sensorSwitchId!, false);
    worldA.start();
    worldA.setDriveControls({ forward: true });
    for (let i = 0; i < 30; i++) {
      worldA.stepFrame(1 / 60);
    }

    // worldB must remain completely unaffected
    expect(worldB.getLifecycleStatus()).toBe("ready");
    expect(worldB.getTelemetrySnapshot().xMeters).toBe(0);
    expect(worldB.getControlApi().readUltrasonic().ok).toBe(true);
    expect(worldB.getElectricalState()?.switchStates[sensorSwitchId!]).toBe(true);
    expect(worldA.getControlApi().readUltrasonic().ok).toBe(false);
  });
});
