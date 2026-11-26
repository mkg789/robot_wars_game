import type { RobotControlApi, RobotControlRoutine } from "../types/control.types";
import type { SensorDescriptor } from "../types/sensor.types";
import type {
  ProgramInstruction,
  ProgramInstructionKind,
  ProgramValidationIssue,
  VisualProgramExecutionTrace,
  VisualRobotProgram,
} from "../types/programWorkspace.types";

let idCounter = 0;
export function nextInstructionId(prefix = "instr"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createDefaultInstruction(
  kind: ProgramInstructionKind
): ProgramInstruction {
  const id = nextInstructionId(kind);
  switch (kind) {
    case "drive":
      return { id, kind: "drive", direction: "forward", power: 0.6, durationSeconds: 1.5 };
    case "turn":
      return { id, kind: "turn", direction: "right", power: 0.5, durationSeconds: 0.8 };
    case "set-motors":
      return { id, kind: "set-motors", leftPower: 0.5, rightPower: 0.5 };
    case "stop":
      return { id, kind: "stop", target: "robot" };
    case "wait":
      return { id, kind: "wait", durationSeconds: 1.0 };
    case "read-ultrasonic":
      return { id, kind: "read-ultrasonic" };
    case "if-ultrasonic":
      return {
        id,
        kind: "if-ultrasonic",
        operator: "below",
        thresholdMeters: 0.9,
        thenInstructions: [
          {
            id: nextInstructionId("stop"),
            kind: "stop",
            target: "robot",
          },
        ],
        elseInstructions: [],
      };
    case "repeat":
      return {
        id,
        kind: "repeat",
        count: 3,
        bodyInstructions: [
          {
            id: nextInstructionId("drive"),
            kind: "drive",
            direction: "forward",
            power: 0.5,
            durationSeconds: 1.0,
          },
        ],
      };
  }
}

function cloneWithFreshIds(instr: ProgramInstruction): ProgramInstruction {
  const freshId = nextInstructionId(instr.kind);
  switch (instr.kind) {
    case "if-ultrasonic":
      return {
        ...instr,
        id: freshId,
        thenInstructions: instr.thenInstructions.map(cloneWithFreshIds),
        elseInstructions: instr.elseInstructions.map(cloneWithFreshIds),
      };
    case "repeat":
      return {
        ...instr,
        id: freshId,
        bodyInstructions: instr.bodyInstructions.map(cloneWithFreshIds),
      };
    default:
      return { ...instr, id: freshId };
  }
}

export function insertInstruction(
  instructions: readonly ProgramInstruction[],
  instruction: ProgramInstruction,
  index?: number
): ProgramInstruction[] {
  const next = [...instructions];
  if (index === undefined || index < 0 || index > next.length) {
    next.push(instruction);
  } else {
    next.splice(index, 0, instruction);
  }
  return next;
}

export function removeInstruction(
  instructions: readonly ProgramInstruction[],
  id: string
): ProgramInstruction[] {
  return instructions
    .filter((item) => item.id !== id)
    .map((item) => {
      if (item.kind === "if-ultrasonic") {
        return {
          ...item,
          thenInstructions: removeInstruction(item.thenInstructions, id),
          elseInstructions: removeInstruction(item.elseInstructions, id),
        };
      }
      if (item.kind === "repeat") {
        return {
          ...item,
          bodyInstructions: removeInstruction(item.bodyInstructions, id),
        };
      }
      return item;
    });
}

export function duplicateInstruction(
  instructions: readonly ProgramInstruction[],
  id: string
): ProgramInstruction[] {
  const next: ProgramInstruction[] = [];
  for (const item of instructions) {
    if (item.id === id) {
      next.push(item, cloneWithFreshIds(item));
      continue;
    }
    if (item.kind === "if-ultrasonic") {
      next.push({
        ...item,
        thenInstructions: duplicateInstruction(item.thenInstructions, id),
        elseInstructions: duplicateInstruction(item.elseInstructions, id),
      });
    } else if (item.kind === "repeat") {
      next.push({
        ...item,
        bodyInstructions: duplicateInstruction(item.bodyInstructions, id),
      });
    } else {
      next.push(item);
    }
  }
  return next;
}

export function moveInstruction(
  instructions: readonly ProgramInstruction[],
  id: string,
  direction: "up" | "down"
): ProgramInstruction[] {
  const idx = instructions.findIndex((i) => i.id === id);
  if (idx !== -1) {
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= instructions.length) return [...instructions];
    const next = [...instructions];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    return next;
  }

  return instructions.map((item) => {
    if (item.kind === "if-ultrasonic") {
      return {
        ...item,
        thenInstructions: moveInstruction(item.thenInstructions, id, direction),
        elseInstructions: moveInstruction(item.elseInstructions, id, direction),
      };
    }
    if (item.kind === "repeat") {
      return {
        ...item,
        bodyInstructions: moveInstruction(item.bodyInstructions, id, direction),
      };
    }
    return item;
  });
}

export function updateInstruction(
  instructions: readonly ProgramInstruction[],
  id: string,
  updater: (current: ProgramInstruction) => ProgramInstruction
): ProgramInstruction[] {
  return instructions.map((item) => {
    if (item.id === id) {
      return updater(item);
    }
    if (item.kind === "if-ultrasonic") {
      return {
        ...item,
        thenInstructions: updateInstruction(item.thenInstructions, id, updater),
        elseInstructions: updateInstruction(item.elseInstructions, id, updater),
      };
    }
    if (item.kind === "repeat") {
      return {
        ...item,
        bodyInstructions: updateInstruction(item.bodyInstructions, id, updater),
      };
    }
    return item;
  });
}

export function validateVisualProgram(
  program: VisualRobotProgram,
  installedSensors?: readonly SensorDescriptor[]
): readonly ProgramValidationIssue[] {
  const issues: ProgramValidationIssue[] = [];

  if (program.instructions.length === 0) {
    issues.push({
      severity: "warning",
      message: "Routine has no instructions yet.",
    });
    return issues;
  }

  const readyUltrasonic = installedSensors?.some(
    (s) =>
      (s.sensorKind === "ultrasonic" || s.sensorKind === "tof-distance") &&
      s.availability === "ready"
  );
  const anyUltrasonicInstalled = installedSensors?.some(
    (s) => s.sensorKind === "ultrasonic" || s.sensorKind === "tof-distance"
  );

  const inspectList = (list: readonly ProgramInstruction[]) => {
    for (const instr of list) {
      switch (instr.kind) {
        case "drive":
        case "turn":
          if (!Number.isFinite(instr.durationSeconds) || instr.durationSeconds <= 0) {
            issues.push({
              severity: "error",
              instructionId: instr.id,
              message: `${instr.kind === "drive" ? "Drive" : "Turn"} duration must be greater than 0 seconds.`,
            });
          }
          if (!Number.isFinite(instr.power) || Math.abs(instr.power) > 1) {
            issues.push({
              severity: "warning",
              instructionId: instr.id,
              message: "Motor power outside [-1, 1] will be clamped cleanly.",
            });
          }
          break;
        case "wait":
          if (!Number.isFinite(instr.durationSeconds) || instr.durationSeconds <= 0) {
            issues.push({
              severity: "error",
              instructionId: instr.id,
              message: "Wait duration must be greater than 0 seconds.",
            });
          }
          break;
        case "set-motors":
          if (Math.abs(instr.leftPower) > 1 || Math.abs(instr.rightPower) > 1) {
            issues.push({
              severity: "warning",
              instructionId: instr.id,
              message: "Set Motors power outside [-1, 1] will be clamped cleanly.",
            });
          }
          break;
        case "read-ultrasonic":
        case "if-ultrasonic":
          if (installedSensors && !anyUltrasonicInstalled) {
            issues.push({
              severity: "warning",
              instructionId: instr.id,
              message: "No ultrasonic distance sensor installed on robot.",
            });
          } else if (installedSensors && !readyUltrasonic) {
            issues.push({
              severity: "warning",
              instructionId: instr.id,
              message: "Ultrasonic sensor is currently unpowered or faulted.",
            });
          }
          if (instr.kind === "if-ultrasonic") {
            if (!Number.isFinite(instr.thresholdMeters) || instr.thresholdMeters <= 0) {
              issues.push({
                severity: "error",
                instructionId: instr.id,
                message: "Distance threshold must be a positive finite distance (m).",
              });
            }
            if (
              instr.thenInstructions.length === 0 &&
              instr.elseInstructions.length === 0
            ) {
              issues.push({
                severity: "warning",
                instructionId: instr.id,
                message: "Conditional block has empty Then and Else branches.",
              });
            }
            inspectList(instr.thenInstructions);
            inspectList(instr.elseInstructions);
          }
          break;
        case "repeat":
          if (!Number.isFinite(instr.count) || instr.count < 1 || instr.count > 50) {
            issues.push({
              severity: "warning",
              instructionId: instr.id,
              message: "Repeat count should be between 1 and 50.",
            });
          }
          if (instr.bodyInstructions.length === 0) {
            issues.push({
              severity: "warning",
              instructionId: instr.id,
              message: "Repeat block body is empty.",
            });
          }
          inspectList(instr.bodyInstructions);
          break;
      }
    }
  };

  inspectList(program.instructions);
  return issues;
}

interface ExecutionFrame {
  readonly list: readonly ProgramInstruction[];
  index: number;
  repeatOwnerId?: string;
  remainingRepeats?: number;
}

/**
 * Compiles a VisualRobotProgram into a deterministic RobotControlRoutine
 * compatible with RobotControlController and SimulationWorld fixed-timestep physics.
 */
export function compileVisualProgramToRoutine(
  program: VisualRobotProgram,
  onTrace?: (trace: VisualProgramExecutionTrace) => void
): RobotControlRoutine {
  let stack: ExecutionFrame[] = [];
  let activeTimerRemaining = 0;
  let activeTimedId: string | null = null;
  let completedIds: string[] = [];
  let lastSensorSummary: string | null = null;

  const emitTrace = (
    activeInstructionId: string | null,
    statusMessage: string | null
  ) => {
    onTrace?.({
      activeInstructionId,
      completedInstructionIds: [...completedIds],
      lastSensorSummary,
      statusMessage,
    });
  };

  const resetVm = () => {
    stack =
      program.instructions.length > 0
        ? [{ list: program.instructions, index: 0 }]
        : [];
    activeTimerRemaining = 0;
    activeTimedId = null;
    completedIds = [];
    lastSensorSummary = null;
  };

  const markCompleted = (id: string) => {
    if (!completedIds.includes(id)) {
      completedIds.push(id);
    }
  };

  const stepInstructionPointer = (api: RobotControlApi): "yield" | "done" => {
    let guardSteps = 0;
    while (stack.length > 0 && guardSteps < 200) {
      guardSteps += 1;
      const top = stack[stack.length - 1];

      if (top.index >= top.list.length) {
        if (top.repeatOwnerId && top.remainingRepeats && top.remainingRepeats > 1) {
          top.remainingRepeats -= 1;
          top.index = 0;
          continue;
        }
        if (top.repeatOwnerId) {
          markCompleted(top.repeatOwnerId);
        }
        stack.pop();
        continue;
      }

      const instr = top.list[top.index];
      switch (instr.kind) {
        case "drive": {
          const sign = instr.direction === "backward" ? -1 : 1;
          const pwr = Math.max(0, Math.min(1, Math.abs(instr.power))) * sign;
          const dur = Math.max(0.01, instr.durationSeconds);
          api.setDifferentialPower(pwr, pwr);
          activeTimedId = instr.id;
          activeTimerRemaining = dur;
          emitTrace(instr.id, `Driving ${instr.direction} at ${pwr.toFixed(2)}`);
          return "yield";
        }
        case "turn": {
          const mag = Math.max(0, Math.min(1, Math.abs(instr.power)));
          const dur = Math.max(0.01, instr.durationSeconds);
          // Heading +theta turns Left (+Z), -theta turns Right (-Z):
          // right turn => left positive, right negative; left turn => left negative, right positive
          const leftP = instr.direction === "right" ? mag : -mag;
          const rightP = instr.direction === "right" ? -mag : mag;
          api.setDifferentialPower(leftP, rightP);
          activeTimedId = instr.id;
          activeTimerRemaining = dur;
          emitTrace(instr.id, `Turning ${instr.direction} at ${mag.toFixed(2)}`);
          return "yield";
        }
        case "wait": {
          const dur = Math.max(0.01, instr.durationSeconds);
          activeTimedId = instr.id;
          activeTimerRemaining = dur;
          emitTrace(instr.id, `Waiting ${dur.toFixed(2)}s`);
          return "yield";
        }
        case "set-motors": {
          api.setDifferentialPower(instr.leftPower, instr.rightPower);
          markCompleted(instr.id);
          top.index += 1;
          emitTrace(instr.id, `Set motors L=${instr.leftPower.toFixed(2)} R=${instr.rightPower.toFixed(2)}`);
          continue;
        }
        case "stop": {
          if (instr.target === "robot") {
            api.stopRobot();
          } else {
            api.stopMotors(instr.target);
          }
          markCompleted(instr.id);
          top.index += 1;
          emitTrace(instr.id, `Stopped ${instr.target}`);
          continue;
        }
        case "read-ultrasonic": {
          const res = api.readUltrasonic(instr.sensorId);
          lastSensorSummary =
            res.ok && res.data
              ? `${res.sensorName ?? "Ultrasonic"}: ${res.data.distanceCm.toFixed(1)} cm${res.data.inRange ? "" : " (max)"}`
              : `Ultrasonic unavailable (${res.reason ?? res.status})`;
          markCompleted(instr.id);
          top.index += 1;
          emitTrace(instr.id, lastSensorSummary);
          continue;
        }
        case "if-ultrasonic": {
          const res = api.readUltrasonic(instr.sensorId);
          let branch = false;
          if (res.ok && res.data) {
            const dist = res.data.distanceMeters;
            branch =
              instr.operator === "below"
                ? dist < instr.thresholdMeters
                : dist > instr.thresholdMeters;
            lastSensorSummary = `If Ultrasonic (${dist.toFixed(2)}m ${instr.operator} ${instr.thresholdMeters.toFixed(2)}m) -> ${branch ? "TRUE" : "FALSE"}`;
          } else {
            lastSensorSummary = `If Ultrasonic unavailable (${res.status}) -> ELSE`;
          }
          markCompleted(instr.id);
          top.index += 1;
          const chosenList = branch ? instr.thenInstructions : instr.elseInstructions;
          if (chosenList.length > 0) {
            stack.push({ list: chosenList, index: 0 });
          }
          emitTrace(instr.id, lastSensorSummary);
          continue;
        }
        case "repeat": {
          const count = Math.max(
            0,
            Math.min(50, Math.floor(Number.isFinite(instr.count) ? instr.count : 0))
          );
          top.index += 1;
          if (count > 0 && instr.bodyInstructions.length > 0) {
            stack.push({
              list: instr.bodyInstructions,
              index: 0,
              repeatOwnerId: instr.id,
              remainingRepeats: count,
            });
          } else {
            markCompleted(instr.id);
          }
          emitTrace(instr.id, `Repeat ×${count}`);
          continue;
        }
      }
    }

    return "done";
  };

  return {
    id: program.id,
    name: program.name,
    description: `Visual routine (${program.instructions.length} top-level step${program.instructions.length === 1 ? "" : "s"})`,
    onStart: () => {
      resetVm();
      emitTrace(null, "Program started");
    },
    onTick: (ctx, api) => {
      if (activeTimedId !== null) {
        activeTimerRemaining -= ctx.dtSeconds;
        if (activeTimerRemaining > 1e-6) {
          return;
        }
        // Timed step finished cleanly: stop drive motors after timed drive/turn before continuing
        const top = stack[stack.length - 1];
        const finishedInstr = top?.list[top.index];
        if (finishedInstr && (finishedInstr.kind === "drive" || finishedInstr.kind === "turn")) {
          api.stopMotors("both");
        }
        markCompleted(activeTimedId);
        if (top) top.index += 1;
        activeTimedId = null;
        activeTimerRemaining = 0;
      }

      const outcome = stepInstructionPointer(api);
      if (outcome === "done") {
        api.completeProgram();
        emitTrace(null, "Routine completed");
      }
    },
    onStop: () => {
      resetVm();
      emitTrace(null, "Program stopped");
    },
  };
}
