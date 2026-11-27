import { beforeEach, describe, expect, it } from "vitest";
import {
  compileVisualProgramToRoutine,
  doesRoutineMatchVisualProgram,
  EMPTY_VISUAL_TRACE,
  invalidateStaleVisualProgramRoutine,
  resetVisualProgramSession,
  runVisualProgramRoutine,
  stepOrResumeVisualProgram,
  stopVisualProgramRoutine,
} from "../../src/features/programming/logic/programWorkspaceCompiler";
import type { VisualRobotProgram } from "../../src/features/programming/types/programWorkspace.types";
import {
  OBSTACLE_TEST_ARENA,
  SimulationWorld,
} from "../../src/features/simulation/logic/simulationWorld";
import { useRobotStore } from "../../src/store/robotStore";
import { assembleConfiguredRobotFixture } from "../fixtures/robotFixtures";

describe("Integration Journeys 5–6: Visual Programming, Sensor Autonomy & Debugger Lifecycle", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  it("Journey 5: executes a compiled visual program with ultrasonic branch decision in OBSTACLE_TEST_ARENA and updates robot kinematics", () => {
    assembleConfiguredRobotFixture({
      addUltrasonic: true,
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

    const program: VisualRobotProgram = {
      version: 1,
      id: "integ-prog-auton",
      name: "Sensor Avoid & Drive",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        { id: "step-read", kind: "read-ultrasonic" },
        {
          id: "step-if",
          kind: "if-ultrasonic",
          operator: "below",
          thresholdMeters: 5.0,
          thenInstructions: [
            {
              id: "step-turn-then",
              kind: "turn",
              direction: "left",
              power: 0.7,
              durationSeconds: 0.3,
            },
          ],
          elseInstructions: [
            {
              id: "step-drive-else",
              kind: "drive",
              direction: "forward",
              power: 0.8,
              durationSeconds: 0.4,
            },
          ],
        },
        { id: "step-stop-end", kind: "stop", target: "robot" },
      ],
    };

    const traces: unknown[] = [];
    expect(runVisualProgramRoutine(world, program, (t) => traces.push(t))).toBe(
      true
    );

    const startYaw = world.getRenderPose().headingRadians;
    for (let i = 0; i < 25; i++) {
      world.stepFrame(1 / 60);
    }

    const ctrl = world.getControlState();
    expect(ctrl.executionTrace?.completedInstructionIds).toContain("step-read");
    expect(ctrl.executionTrace?.completedInstructionIds).toContain("step-if");
    expect(ctrl.executionTrace?.skippedInstructionIds).toContain(
      "step-drive-else"
    );
    expect(world.getRenderPose().headingRadians).not.toBeCloseTo(startYaw, 3);
    expect(traces.length).toBeGreaterThan(0);

    // Safe manual takeover clears autonomous program outputs
    world.setManualControlMode();
    expect(world.getControlState().controlSource).toBe("manual");
    expect(world.getControlState().leftPower).toBe(0);
    expect(world.getControlState().rightPower).toBe(0);
  });

  it("Journey 6: preserves debugger VM state across simulated workspace exits, enforces single-step/pause/stop trace retention & zero motor output", () => {
    assembleConfiguredRobotFixture({
      addUltrasonic: true,
      wireEscAndMotors: true,
    });
    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      electricalConnections: st.electricalConnections,
    }).world!;

    const program: VisualRobotProgram = {
      version: 1,
      id: "integ-prog-debug",
      name: "Debugger Integration Routine",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        {
          id: "drv-1",
          kind: "drive",
          direction: "forward",
          power: 0.75,
          durationSeconds: 0.5,
        },
        {
          id: "drv-2",
          kind: "turn",
          direction: "right",
          power: 0.6,
          durationSeconds: 0.4,
        },
      ],
    };

    const routine = compileVisualProgramToRoutine(program);
    world.setProgramRoutine(routine);

    // Step 1 starts timed drv-1 cleanly and leaves debugger paused with zero motor output
    expect(stepOrResumeVisualProgram(world, program, () => {})).not.toBeNull();
    expect(world.getControlState().programStatus).toBe("paused");
    expect(world.getControlState().leftPower).toBe(0);
    expect(world.getControlState().rightPower).toBe(0);

    // Resume and advance briefly, then pause explicitly
    expect(world.resumeProgram()).toBe(true);
    for (let i = 0; i < 6; i++) {
      world.stepFrame(1 / 60);
    }
    expect(world.pauseProgram()).toBe(true);
    expect(world.getControlState().leftPower).toBe(0);
    expect(world.getControlState().rightPower).toBe(0);

    // Switching workspace tab re-checks routine match & invalidation without restarting when unchanged
    expect(doesRoutineMatchVisualProgram(world.getActiveRoutine(), program)).toBe(
      true
    );
    const kept = invalidateStaleVisualProgramRoutine(world, program, () => {});
    expect(kept).toBe(false);
    expect(world.getControlState().programStatus).toBe("paused");

    // Stop retains execution trace observability while zeroing motor targets
    let stoppedTrace: unknown = null;
    stopVisualProgramRoutine(world, (trace) => {
      stoppedTrace = trace;
    });
    expect(stoppedTrace).toBeTruthy();
    expect(world.getControlState().programStatus).toBe("stopped");
    expect(world.getControlState().leftPower).toBe(0);
    expect(world.getControlState().rightPower).toBe(0);

    // Modifying program invalidates stale compiled routine cleanly
    const editedProgram: VisualRobotProgram = {
      ...program,
      instructions: [
        ...program.instructions,
        { id: "stop-3", kind: "stop", target: "both" },
      ],
    };
    const invalidated = invalidateStaleVisualProgramRoutine(
      world,
      editedProgram,
      () => {}
    );
    expect(invalidated).toBe(true);
    let resetTrace: unknown = null;
    resetVisualProgramSession(world, (trace) => {
      resetTrace = trace;
    });
    expect(resetTrace).toEqual(EMPTY_VISUAL_TRACE);
  });
});
