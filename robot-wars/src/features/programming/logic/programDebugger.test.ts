import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { OBSTACLE_TEST_ARENA, SimulationWorld } from "../../simulation/logic/simulationWorld";
import type { RobotControlRoutine } from "../types/control.types";
import type { VisualRobotProgram } from "../types/programWorkspace.types";
import { compileVisualProgramToRoutine } from "./programWorkspaceCompiler";

function assembleRobot(withUltrasonic = true) {
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

  if (withUltrasonic) {
    useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-hcsr04-ultrasonic", {
        position: [1.25, 0.15, 0],
      });
  }
}

describe("Phase 6.3: Program Debugger & Execution Observability", () => {
  beforeEach(() => {
    assembleRobot(true);
  });

  it("pauses active timed routines with zero motor output and resumes cleanly", () => {
    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
    }).world!;

    const prog: VisualRobotProgram = {
      version: 1,
      id: "prog-pause-resume",
      name: "Pause Resume Drive",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        {
          id: "drv-pause",
          kind: "drive",
          direction: "forward",
          power: 0.8,
          durationSeconds: 0.6,
        },
      ],
    };

    const routine = compileVisualProgramToRoutine(prog);
    world.setProgramRoutine(routine);
    expect(world.startProgram()).toBe(true);

    // Run ~0.15s so drive is active
    for (let i = 0; i < 9; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.getControlState().programStatus).toBe("running");
    expect(world.getControlState().leftPower).toBeCloseTo(0.8, 2);

    // Pause halts motor outputs immediately and refuses to advance routine during subsequent ticks
    expect(world.pauseProgram()).toBe(true);
    const pausedState = world.getControlState();
    expect(pausedState.programStatus).toBe("paused");
    expect(pausedState.leftPower).toBe(0);
    expect(pausedState.rightPower).toBe(0);

    for (let i = 0; i < 20; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.getControlState().programStatus).toBe("paused");
    expect(world.getControlState().leftPower).toBe(0);

    // Resume restores remaining timed drive duration and finishes deterministically
    expect(world.resumeProgram()).toBe(true);
    expect(world.getControlState().programStatus).toBe("running");
    expect(world.getControlState().leftPower).toBeCloseTo(0.8, 2);

    for (let i = 0; i < 45; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.getControlState().programStatus).toBe("completed");
    expect(world.getControlState().leftPower).toBe(0);
    expect(world.getControlState().executionTrace?.completedInstructionIds).toContain(
      "drv-pause"
    );
  });

  it("supports single-step execution, skipped branch tracking, and repeat progress trace history", () => {
    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      arena: OBSTACLE_TEST_ARENA,
    }).world!;

    const prog: VisualRobotProgram = {
      version: 1,
      id: "prog-single-step",
      name: "Step & Trace",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        { id: "sonar-1", kind: "read-ultrasonic" },
        {
          id: "if-close",
          kind: "if-ultrasonic",
          operator: "below",
          thresholdMeters: 1.5, // TRUE (~1.10m < 1.5m): skips ELSE
          thenInstructions: [{ id: "stop-then", kind: "stop", target: "robot" }],
          elseInstructions: [
            {
              id: "drv-else",
              kind: "drive",
              direction: "forward",
              power: 0.5,
              durationSeconds: 0.5,
            },
          ],
        },
        {
          id: "loop-2",
          kind: "repeat",
          count: 2,
          bodyInstructions: [
            { id: "wait-loop", kind: "wait", durationSeconds: 0.2 },
          ],
        },
      ],
    };

    const routine = compileVisualProgramToRoutine(prog);
    world.setProgramRoutine(routine);

    // Step 1: read-ultrasonic
    world.stepProgram();
    let trace = world.getControlState().executionTrace!;
    expect(world.getControlState().programStatus).toBe("paused");
    expect(trace.completedInstructionIds).toContain("sonar-1");
    expect(trace.lastSensorStatus).toBe("normal");
    expect(trace.lastSensorSummary).toContain("Ultrasonic");

    // Step 2: if-ultrasonic takes THEN branch and marks ELSE skipped
    world.stepProgram();
    trace = world.getControlState().executionTrace!;
    expect(trace.completedInstructionIds).toContain("if-close");
    expect(trace.skippedInstructionIds).toContain("drv-else");
    expect(trace.lastBranchOutcome).toContain("TRUE");

    // Step 3: stop-then
    world.stepProgram();
    trace = world.getControlState().executionTrace!;
    expect(trace.completedInstructionIds).toContain("stop-then");

    // Step 4: enter repeat x2
    world.stepProgram();
    trace = world.getControlState().executionTrace!;
    expect(trace.repeatProgressById["loop-2"]).toEqual({
      currentIteration: 1,
      totalIterations: 2,
    });

    // Finish stepping wait iterations cleanly to completion
    for (let i = 0; i < 6; i++) {
      if (world.getControlState().programStatus === "completed") break;
      world.stepProgram();
    }
    const finalState = world.getControlState();
    expect(finalState.programStatus).toBe("completed");
    expect(finalState.executionTrace!.history.length).toBeGreaterThanOrEqual(5);
    expect(finalState.executionTrace!.history[0].timestampSeconds).toBeGreaterThanOrEqual(0);
  });

  it("distinguishes missing/unavailable sensors from valid readings during execution", () => {
    assembleRobot(false); // No ultrasonic installed
    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
    }).world!;

    const prog: VisualRobotProgram = {
      version: 1,
      id: "prog-no-sensor",
      name: "Unavailable Sensor Trace",
      updatedAtIso: new Date().toISOString(),
      instructions: [{ id: "r-missing", kind: "read-ultrasonic" }],
    };

    world.setProgramRoutine(compileVisualProgramToRoutine(prog));
    world.startProgram();
    world.stepFrame(1 / 60);

    const trace = world.getControlState().executionTrace!;
    expect(trace.lastSensorStatus).toBe("unavailable");
    expect(trace.lastSensorSummary).toContain("unavailable");
  });

  it("isolates runtime faults, halts motors safely, attributes failure, and clears cleanly on Reset", () => {
    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
    }).world!;

    const faultingRoutine: RobotControlRoutine = {
      id: "fault-routine",
      name: "Faulting Test Routine",
      description: "Throws after initial motor command",
      onStart: (api) => {
        api.reportExecutionTrace?.({
          activeInstructionId: "bad-step-1",
          completedInstructionIds: [],
          skippedInstructionIds: [],
          failedInstructionId: null,
          repeatProgressById: {},
          lastSensorSummary: null,
          lastSensorStatus: null,
          lastBranchOutcome: null,
          statusMessage: "Running bad-step-1",
          errorMessage: null,
          history: [],
        });
        api.setDifferentialPower(0.9, 0.9);
      },
      onTick: () => {
        throw new Error("Simulated controller runtime exception");
      },
    };

    world.setProgramRoutine(faultingRoutine);
    expect(world.startProgram()).toBe(true);
    expect(world.getControlState().leftPower).toBeCloseTo(0.9, 2);

    // Step triggers thrown error -> safely caught, motors zeroed, fault attributed
    expect(() => world.stepFrame(1 / 60)).not.toThrow();
    const faultState = world.getControlState();
    expect(faultState.programStatus).toBe("fault");
    expect(faultState.leftPower).toBe(0);
    expect(faultState.rightPower).toBe(0);
    expect(faultState.lastError).toContain("Simulated controller runtime exception");
    expect(faultState.executionTrace?.failedInstructionId).toBe("bad-step-1");
    expect(faultState.executionTrace?.history.some((h) => h.outcome === "fault")).toBe(
      true
    );

    // Reset wipes debugging + error state cleanly for safe re-execution
    world.reset();
    const resetState = world.getControlState();
    expect(resetState.programStatus).toBe("idle");
    expect(resetState.lastError).toBeNull();
    expect(resetState.executionTrace).toBeNull();
  });
});
