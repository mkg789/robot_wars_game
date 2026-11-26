import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { OBSTACLE_TEST_ARENA, SimulationWorld } from "../../simulation/logic/simulationWorld";
import {
  clearVisualProgramStorage,
  createEmptyVisualProgram,
  deleteSavedVisualProgram,
  loadSavedVisualPrograms,
  saveVisualProgram,
} from "./programPersistence";
import {
  compileVisualProgramToRoutine,
  createDefaultInstruction,
  duplicateInstruction,
  insertInstruction,
  moveInstruction,
  removeInstruction,
  updateInstruction,
  validateVisualProgram,
} from "./programWorkspaceCompiler";
import type { VisualRobotProgram } from "../types/programWorkspace.types";

function buildRobotWithUltrasonic() {
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
  const leftM = st.parts.find((p) => p.type === "Motor" && p.mountingZoneId === "front-left")!;
  const rightM = st.parts.find((p) => p.type === "Motor" && p.mountingZoneId === "front-right")!;
  st.selectWheelCatalogueItem("standard-rubber");
  st.assignWheel(leftM.id);
  useRobotStore.getState().assignWheel(rightM.id);
  useRobotStore.getState().applySuggestedDrivetrainMapping(true);

  useRobotStore
    .getState()
    .installElectricalCatalogueItem("elec-hcsr04-ultrasonic", {
      position: [1.25, 0.15, 0],
    });
}

describe("Phase 6.2: Visual Robot Programming Workspace", () => {
  beforeEach(() => {
    clearVisualProgramStorage();
    buildRobotWithUltrasonic();
  });

  it("supports workspace CRUD operations, reordering, duplication with fresh IDs, and validation", () => {
    const emptyProg = createEmptyVisualProgram("Custom Patrol");
    expect(validateVisualProgram(emptyProg).some((i) => i.severity === "warning")).toBe(true);

    const drv = createDefaultInstruction("drive");
    const trn = createDefaultInstruction("turn");
    let list = insertInstruction([], drv);
    list = insertInstruction(list, trn);
    expect(list).toHaveLength(2);

    // Move Turn before Drive
    list = moveInstruction(list, trn.id, "up");
    expect(list[0].id).toBe(trn.id);

    // Duplicate creates distinct ID
    list = duplicateInstruction(list, trn.id);
    expect(list).toHaveLength(3);
    expect(list[0].id).not.toBe(list[1].id);

    // Update parameter inline + invalid duration detection
    list = updateInstruction(list, list[0].id, (cur) =>
      cur.kind === "turn" ? { ...cur, durationSeconds: -1 } : cur
    );
    const issues = validateVisualProgram({
      ...emptyProg,
      instructions: list,
    });
    expect(issues.some((i) => i.severity === "error")).toBe(true);

    // Remove instruction cleans cleanly
    list = removeInstruction(list, list[0].id);
    expect(list).toHaveLength(2);
  });

  it("compiles movement instructions and repeat loops into executable SimulationWorld routines cleanly", () => {
    const prog: VisualRobotProgram = {
      version: 1,
      id: "prog-repeat-move",
      name: "Repeat Drive",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        {
          id: "rep-1",
          kind: "repeat",
          count: 2,
          bodyInstructions: [
            {
              id: "drv-1",
              kind: "drive",
              direction: "forward",
              power: 0.7,
              durationSeconds: 0.4,
            },
            {
              id: "wait-1",
              kind: "wait",
              durationSeconds: 0.1,
            },
          ],
        },
        {
          id: "turn-1",
          kind: "turn",
          direction: "right",
          power: 0.6,
          durationSeconds: 0.3,
        },
      ],
    };

    const st = useRobotStore.getState();
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
    }).world!;

    let lastTraceStatus: string | null = null;
    const routine = compileVisualProgramToRoutine(prog, (trace) => {
      lastTraceStatus = trace.statusMessage;
    });
    world.setProgramRoutine(routine);
    expect(world.startProgram()).toBe(true);

    // Execute full 2x(0.4 + 0.1) + 0.3 = 1.3s + margin cleanly
    for (let i = 0; i < 100; i++) {
      world.stepFrame(1 / 60);
    }

    const telemetry = world.getTelemetrySnapshot();
    const ctrl = world.getControlState();
    expect(telemetry.xMeters).toBeGreaterThan(0.15);
    expect(telemetry.headingRadians).toBeLessThan(-0.05); // Right turn -> negative yaw
    expect(ctrl.programStatus).toBe("completed");
    expect(ctrl.leftPower).toBe(0);
    expect(ctrl.rightPower).toBe(0);
    expect(lastTraceStatus).toBe("Routine completed");
  });

  it("evaluates ultrasonic conditional branches cleanly (Then vs Else) and respects Stop / Reset", () => {
    const st = useRobotStore.getState();
    // OBSTACLE_TEST_ARENA has pillar at x = +2.35; sensor nose at x = 1.25 sees ~1.10m!
    const world = SimulationWorld.fromAssembly({
      parts: st.parts,
      connections: st.connections,
      drivetrain: st.drivetrain,
      foundation: st.foundation,
      arena: OBSTACLE_TEST_ARENA,
    }).world!;

    const condProg: VisualRobotProgram = {
      version: 1,
      id: "prog-cond",
      name: "Branch Check",
      updatedAtIso: new Date().toISOString(),
      instructions: [
        { id: "r-1", kind: "read-ultrasonic" },
        {
          id: "if-1",
          kind: "if-ultrasonic",
          operator: "below",
          thresholdMeters: 1.5, // True! 1.10 < 1.5 -> THEN branch turns left; ELSE drives backward
          thenInstructions: [
            {
              id: "then-motors",
              kind: "set-motors",
              leftPower: -0.5,
              rightPower: 0.5,
            },
            { id: "then-wait", kind: "wait", durationSeconds: 0.25 },
          ],
          elseInstructions: [
            {
              id: "else-drv",
              kind: "drive",
              direction: "backward",
              power: 0.5,
              durationSeconds: 0.25,
            },
          ],
        },
      ],
    };

    let sensorNote: string | null = null;
    const routine = compileVisualProgramToRoutine(condProg, (trace) => {
      if (trace.lastSensorSummary) sensorNote = trace.lastSensorSummary;
    });
    world.setProgramRoutine(routine);
    world.startProgram();

    for (let i = 0; i < 6; i++) {
      world.stepFrame(1 / 60);
    }
    expect(sensorNote).toContain("TRUE");
    expect(world.getControlState().leftPower).toBeCloseTo(-0.5, 2);
    expect(world.getControlState().rightPower).toBeCloseTo(0.5, 2);

    // Stop halts motors cleanly before natural completion
    world.stopProgram();
    expect(world.getControlState().programStatus).toBe("stopped");
    expect(world.getControlState().leftPower).toBe(0);

    // Reset restores clean ready state
    world.reset();
    expect(world.getControlState().programStatus).toBe("idle");
    expect(world.getTelemetrySnapshot().timeSeconds).toBe(0);
  });

  it("saves, loads, and deletes constructed routines via persistence", () => {
    const prog = createEmptyVisualProgram("Persisted Mission");
    const withDrive: VisualRobotProgram = {
      ...prog,
      instructions: [createDefaultInstruction("drive")],
    };

    saveVisualProgram(withDrive);
    const loaded = loadSavedVisualPrograms();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Persisted Mission");
    expect(loaded[0].instructions[0].kind).toBe("drive");

    const remaining = deleteSavedVisualProgram(withDrive.id);
    expect(remaining).toHaveLength(0);
    expect(loadSavedVisualPrograms()).toHaveLength(0);
  });
});
