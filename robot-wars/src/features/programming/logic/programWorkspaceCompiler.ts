import type { RobotControlApi, RobotControlRoutine } from "../types/control.types";
import type { SensorDescriptor } from "../types/sensor.types";
import type {
  ProgramInstruction,
  ProgramInstructionKind,
  ProgramTraceHistoryEntry,
  ProgramValidationIssue,
  TraceSensorStatus,
  VisualProgramExecutionTrace,
  VisualRobotProgram,
} from "../types/programWorkspace.types";

export const EMPTY_VISUAL_TRACE: VisualProgramExecutionTrace = Object.freeze({
  activeInstructionId: null,
  completedInstructionIds: [],
  skippedInstructionIds: [],
  failedInstructionId: null,
  repeatProgressById: {},
  lastSensorSummary: null,
  lastSensorStatus: null,
  lastBranchOutcome: null,
  statusMessage: null,
  errorMessage: null,
  history: [],
});

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
  totalRepeats?: number;
  remainingRepeats?: number;
}

const MAX_TRACE_HISTORY = 40;

function formatInstructionTitle(instr: ProgramInstruction): string {
  switch (instr.kind) {
    case "drive":
      return `Drive ${instr.direction}`;
    case "turn":
      return `Turn ${instr.direction}`;
    case "set-motors":
      return "Set Motors";
    case "stop":
      return `Stop (${instr.target})`;
    case "wait":
      return "Wait";
    case "read-ultrasonic":
      return "Read Ultrasonic";
    case "if-ultrasonic":
      return "If Ultrasonic";
    case "repeat":
      return "Repeat Loop";
  }
}

function formatInstructionParams(instr: ProgramInstruction): string {
  switch (instr.kind) {
    case "drive":
    case "turn":
      return `pwr=${instr.power.toFixed(2)}, ${instr.durationSeconds.toFixed(2)}s`;
    case "set-motors":
      return `L=${instr.leftPower.toFixed(2)}, R=${instr.rightPower.toFixed(2)}`;
    case "stop":
      return instr.target;
    case "wait":
      return `${instr.durationSeconds.toFixed(2)}s`;
    case "read-ultrasonic":
      return instr.sensorId ?? "default";
    case "if-ultrasonic":
      return `${instr.operator} ${instr.thresholdMeters.toFixed(2)}m`;
    case "repeat":
      return `×${instr.count}`;
  }
}

function collectNestedIds(list: readonly ProgramInstruction[]): string[] {
  const out: string[] = [];
  for (const item of list) {
    out.push(item.id);
    if (item.kind === "if-ultrasonic") {
      out.push(...collectNestedIds(item.thenInstructions));
      out.push(...collectNestedIds(item.elseInstructions));
    } else if (item.kind === "repeat") {
      out.push(...collectNestedIds(item.bodyInstructions));
    }
  }
  return out;
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
  let activeTimedInstr: ProgramInstruction | null = null;
  let activeTimedMotors: { readonly left: number; readonly right: number } | null = null;
  let completedIds: string[] = [];
  let skippedIds: string[] = [];
  let repeatProgressById: Record<
    string,
    { readonly currentIteration: number; readonly totalIterations: number }
  > = {};
  let lastSensorSummary: string | null = null;
  let lastSensorStatus: TraceSensorStatus | null = null;
  let lastBranchOutcome: string | null = null;
  let history: ProgramTraceHistoryEntry[] = [];
  let traceCounter = 0;
  let currentLeft = 0;
  let currentRight = 0;
  let latestTimestamp = 0;

  const pushHistory = (entry: Omit<ProgramTraceHistoryEntry, "id">) => {
    traceCounter += 1;
    history = [
      ...history.slice(-(MAX_TRACE_HISTORY - 1)),
      { ...entry, id: `trace-${traceCounter}` },
    ];
  };

  const emitTrace = (
    api: RobotControlApi | null,
    activeInstructionId: string | null,
    statusMessage: string | null
  ) => {
    const snapshot: VisualProgramExecutionTrace = {
      activeInstructionId,
      completedInstructionIds: [...completedIds],
      skippedInstructionIds: [...skippedIds],
      failedInstructionId: null,
      repeatProgressById: { ...repeatProgressById },
      lastSensorSummary,
      lastSensorStatus,
      lastBranchOutcome,
      statusMessage,
      errorMessage: null,
      history: [...history],
    };
    onTrace?.(snapshot);
    api?.reportExecutionTrace?.(snapshot);
  };

  const resetVm = () => {
    stack =
      program.instructions.length > 0
        ? [{ list: program.instructions, index: 0 }]
        : [];
    activeTimerRemaining = 0;
    activeTimedId = null;
    activeTimedInstr = null;
    activeTimedMotors = null;
    completedIds = [];
    skippedIds = [];
    repeatProgressById = {};
    lastSensorSummary = null;
    lastSensorStatus = null;
    lastBranchOutcome = null;
    history = [];
    currentLeft = 0;
    currentRight = 0;
    latestTimestamp = 0;
  };

  const markCompleted = (id: string) => {
    if (!completedIds.includes(id)) {
      completedIds.push(id);
    }
    if (skippedIds.includes(id)) {
      skippedIds = skippedIds.filter((sid) => sid !== id);
    }
  };

  const markSkipped = (list: readonly ProgramInstruction[]) => {
    for (const item of list) {
      if (!skippedIds.includes(item.id)) {
        skippedIds.push(item.id);
      }
      pushHistory({
        instructionId: item.id,
        instructionKind: item.kind,
        title: formatInstructionTitle(item),
        paramsSummary: formatInstructionParams(item),
        outcome: "skipped",
        details: "Branch not taken",
        timestampSeconds: latestTimestamp,
        motorPower: { left: currentLeft, right: currentRight },
      });
      if (item.kind === "if-ultrasonic") {
        markSkipped(item.thenInstructions);
        markSkipped(item.elseInstructions);
      } else if (item.kind === "repeat") {
        markSkipped(item.bodyInstructions);
      }
    }
  };

  const finishActiveTimedBlock = (api: RobotControlApi) => {
    if (!activeTimedId || !activeTimedInstr) return;
    if (
      activeTimedInstr.kind === "drive" ||
      activeTimedInstr.kind === "turn"
    ) {
      const stopRes = api.stopMotors("both");
      currentLeft = stopRes.leftPower;
      currentRight = stopRes.rightPower;
    }
    markCompleted(activeTimedId);
    pushHistory({
      instructionId: activeTimedInstr.id,
      instructionKind: activeTimedInstr.kind,
      title: formatInstructionTitle(activeTimedInstr),
      paramsSummary: formatInstructionParams(activeTimedInstr),
      outcome: "completed",
      details: "Timed instruction finished",
      timestampSeconds: latestTimestamp,
      motorPower: { left: currentLeft, right: currentRight },
    });
    const top = stack[stack.length - 1];
    if (top) top.index += 1;
    activeTimedId = null;
    activeTimedInstr = null;
    activeTimedMotors = null;
    activeTimerRemaining = 0;
  };

  const MAX_INSTANT_STEPS_PER_TICK = 2000;

  const stepInstructionPointer = (
    api: RobotControlApi,
    isSingleStep: boolean
  ): "yield" | "done" => {
    let guardSteps = 0;
    while (stack.length > 0 && guardSteps < MAX_INSTANT_STEPS_PER_TICK) {
      guardSteps += 1;
      const top = stack[stack.length - 1];

      if (top.index >= top.list.length) {
        if (top.repeatOwnerId && top.remainingRepeats && top.remainingRepeats > 1) {
          top.remainingRepeats -= 1;
          top.index = 0;
          const resetIds = new Set(collectNestedIds(top.list));
          completedIds = completedIds.filter((id) => !resetIds.has(id));
          skippedIds = skippedIds.filter((id) => !resetIds.has(id));
          const total = top.totalRepeats ?? top.remainingRepeats;
          const curIter = total - top.remainingRepeats + 1;
          repeatProgressById[top.repeatOwnerId] = {
            currentIteration: curIter,
            totalIterations: total,
          };
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
          if (!Number.isFinite(instr.durationSeconds) || instr.durationSeconds <= 0) {
            emitTrace(api, instr.id, "Invalid drive duration");
            throw new Error(
              `Drive instruction "${instr.id}" has invalid duration (${String(instr.durationSeconds)}).`
            );
          }
          const sign = instr.direction === "backward" ? -1 : 1;
          const rawPower = Number.isFinite(instr.power) ? instr.power : 0;
          const pwr = Math.max(0, Math.min(1, Math.abs(rawPower))) * sign;
          const dur = Math.max(0.01, instr.durationSeconds);
          const res = api.setDifferentialPower(pwr, pwr);
          currentLeft = res.leftPower;
          currentRight = res.rightPower;
          activeTimedId = instr.id;
          activeTimedInstr = instr;
          activeTimedMotors = { left: res.leftPower, right: res.rightPower };
          activeTimerRemaining = dur;
          pushHistory({
            instructionId: instr.id,
            instructionKind: instr.kind,
            title: formatInstructionTitle(instr),
            paramsSummary: formatInstructionParams(instr),
            outcome: "active",
            details: `Driving ${instr.direction} (${pwr.toFixed(2)})`,
            timestampSeconds: latestTimestamp,
            motorPower: { left: currentLeft, right: currentRight },
          });
          emitTrace(api, instr.id, `Driving ${instr.direction} at ${pwr.toFixed(2)}`);
          return "yield";
        }
        case "turn": {
          if (!Number.isFinite(instr.durationSeconds) || instr.durationSeconds <= 0) {
            emitTrace(api, instr.id, "Invalid turn duration");
            throw new Error(
              `Turn instruction "${instr.id}" has invalid duration (${String(instr.durationSeconds)}).`
            );
          }
          const rawPower = Number.isFinite(instr.power) ? instr.power : 0;
          const mag = Math.max(0, Math.min(1, Math.abs(rawPower)));
          const dur = Math.max(0.01, instr.durationSeconds);
          const leftP = instr.direction === "right" ? mag : -mag;
          const rightP = instr.direction === "right" ? -mag : mag;
          const res = api.setDifferentialPower(leftP, rightP);
          currentLeft = res.leftPower;
          currentRight = res.rightPower;
          activeTimedId = instr.id;
          activeTimedInstr = instr;
          activeTimedMotors = { left: res.leftPower, right: res.rightPower };
          activeTimerRemaining = dur;
          pushHistory({
            instructionId: instr.id,
            instructionKind: instr.kind,
            title: formatInstructionTitle(instr),
            paramsSummary: formatInstructionParams(instr),
            outcome: "active",
            details: `Turning ${instr.direction} (${mag.toFixed(2)})`,
            timestampSeconds: latestTimestamp,
            motorPower: { left: currentLeft, right: currentRight },
          });
          emitTrace(api, instr.id, `Turning ${instr.direction} at ${mag.toFixed(2)}`);
          return "yield";
        }
        case "wait": {
          if (!Number.isFinite(instr.durationSeconds) || instr.durationSeconds <= 0) {
            emitTrace(api, instr.id, "Invalid wait duration");
            throw new Error(
              `Wait instruction "${instr.id}" has invalid duration (${String(instr.durationSeconds)}).`
            );
          }
          const dur = Math.max(0.01, instr.durationSeconds);
          activeTimedId = instr.id;
          activeTimedInstr = instr;
          activeTimedMotors = null;
          activeTimerRemaining = dur;
          pushHistory({
            instructionId: instr.id,
            instructionKind: instr.kind,
            title: formatInstructionTitle(instr),
            paramsSummary: formatInstructionParams(instr),
            outcome: "active",
            details: `Waiting ${dur.toFixed(2)}s`,
            timestampSeconds: latestTimestamp,
            motorPower: { left: currentLeft, right: currentRight },
          });
          emitTrace(api, instr.id, `Waiting ${dur.toFixed(2)}s`);
          return "yield";
        }
        case "set-motors": {
          const res = api.setDifferentialPower(instr.leftPower, instr.rightPower);
          currentLeft = res.leftPower;
          currentRight = res.rightPower;
          markCompleted(instr.id);
          top.index += 1;
          pushHistory({
            instructionId: instr.id,
            instructionKind: instr.kind,
            title: formatInstructionTitle(instr),
            paramsSummary: formatInstructionParams(instr),
            outcome: "completed",
            details: `Set L=${currentLeft.toFixed(2)} R=${currentRight.toFixed(2)}`,
            timestampSeconds: latestTimestamp,
            motorPower: { left: currentLeft, right: currentRight },
          });
          emitTrace(api, instr.id, `Set motors L=${currentLeft.toFixed(2)} R=${currentRight.toFixed(2)}`);
          if (isSingleStep) return "yield";
          continue;
        }
        case "stop": {
          const res =
            instr.target === "robot"
              ? api.stopRobot()
              : api.stopMotors(instr.target);
          currentLeft = res.leftPower;
          currentRight = res.rightPower;
          markCompleted(instr.id);
          top.index += 1;
          pushHistory({
            instructionId: instr.id,
            instructionKind: instr.kind,
            title: formatInstructionTitle(instr),
            paramsSummary: formatInstructionParams(instr),
            outcome: "completed",
            details: `Stopped ${instr.target}`,
            timestampSeconds: latestTimestamp,
            motorPower: { left: currentLeft, right: currentRight },
          });
          emitTrace(api, instr.id, `Stopped ${instr.target}`);
          if (isSingleStep) return "yield";
          continue;
        }
        case "read-ultrasonic": {
          const res = api.readUltrasonic(instr.sensorId);
          lastSensorStatus = res.ok
            ? "normal"
            : res.status === "unavailable-electrical-fault"
              ? "error"
              : "unavailable";
          lastSensorSummary =
            res.ok && res.data
              ? `${res.sensorName ?? "Ultrasonic"}: ${res.data.distanceCm.toFixed(1)} cm${res.data.inRange ? "" : " (max)"}`
              : `Ultrasonic unavailable (${res.reason ?? res.status})`;
          markCompleted(instr.id);
          top.index += 1;
          pushHistory({
            instructionId: instr.id,
            instructionKind: instr.kind,
            title: formatInstructionTitle(instr),
            paramsSummary: formatInstructionParams(instr),
            outcome: "completed",
            details: lastSensorSummary,
            timestampSeconds: latestTimestamp,
            motorPower: { left: currentLeft, right: currentRight },
            sensorValueSummary: lastSensorSummary,
            sensorStatus: lastSensorStatus,
          });
          emitTrace(api, instr.id, lastSensorSummary);
          if (isSingleStep) return "yield";
          continue;
        }
        case "if-ultrasonic": {
          if (!Number.isFinite(instr.thresholdMeters) || instr.thresholdMeters <= 0) {
            emitTrace(api, instr.id, "Invalid ultrasonic threshold");
            throw new Error(
              `If-Ultrasonic instruction "${instr.id}" has invalid distance threshold (${String(instr.thresholdMeters)}).`
            );
          }
          const res = api.readUltrasonic(instr.sensorId);
          let branch = false;
          if (res.ok && res.data) {
            lastSensorStatus = "normal";
            const dist = res.data.distanceMeters;
            branch =
              instr.operator === "below"
                ? dist < instr.thresholdMeters
                : dist > instr.thresholdMeters;
            lastSensorSummary = `${res.sensorName ?? "Ultrasonic"}: ${dist.toFixed(2)} m (${branch ? "TRUE" : "FALSE"})`;
            lastBranchOutcome = `IF ${branch ? "TRUE" : "FALSE"} (${dist.toFixed(2)}m ${instr.operator} ${instr.thresholdMeters.toFixed(2)}m) -> ${branch ? "THEN" : "ELSE"}`;
          } else {
            lastSensorStatus =
              res.status === "unavailable-electrical-fault" ? "error" : "unavailable";
            lastSensorSummary = `Ultrasonic unavailable (${res.status})`;
            lastBranchOutcome = `IF unavailable (${res.status}) -> ELSE`;
          }
          markCompleted(instr.id);
          top.index += 1;
          const chosenList = branch ? instr.thenInstructions : instr.elseInstructions;
          const skippedList = branch ? instr.elseInstructions : instr.thenInstructions;
          if (skippedList.length > 0) {
            markSkipped(skippedList);
          }
          if (chosenList.length > 0) {
            stack.push({ list: chosenList, index: 0 });
          }
          pushHistory({
            instructionId: instr.id,
            instructionKind: instr.kind,
            title: formatInstructionTitle(instr),
            paramsSummary: formatInstructionParams(instr),
            outcome: "completed",
            details: lastBranchOutcome,
            timestampSeconds: latestTimestamp,
            motorPower: { left: currentLeft, right: currentRight },
            sensorValueSummary: lastSensorSummary,
            sensorStatus: lastSensorStatus,
          });
          emitTrace(api, instr.id, lastBranchOutcome);
          if (isSingleStep) return "yield";
          continue;
        }
        case "repeat": {
          const count = Math.max(
            0,
            Math.min(50, Math.floor(Number.isFinite(instr.count) ? instr.count : 0))
          );
          top.index += 1;
          if (count > 0 && instr.bodyInstructions.length > 0) {
            repeatProgressById[instr.id] = {
              currentIteration: 1,
              totalIterations: count,
            };
            stack.push({
              list: instr.bodyInstructions,
              index: 0,
              repeatOwnerId: instr.id,
              totalRepeats: count,
              remainingRepeats: count,
            });
          } else {
            markCompleted(instr.id);
          }
          pushHistory({
            instructionId: instr.id,
            instructionKind: instr.kind,
            title: formatInstructionTitle(instr),
            paramsSummary: formatInstructionParams(instr),
            outcome: "completed",
            details: `Enter loop ×${count}`,
            timestampSeconds: latestTimestamp,
            motorPower: { left: currentLeft, right: currentRight },
          });
          emitTrace(api, instr.id, `Repeat ×${count}`);
          if (isSingleStep) return "yield";
          continue;
        }
      }
    }

    if (stack.length > 0) {
      emitTrace(api, null, "Yielding synchronous instruction batch");
      return "yield";
    }
    return "done";
  };

  return {
    id: program.id,
    name: program.name,
    description: `Visual routine (${program.instructions.length} top-level step${program.instructions.length === 1 ? "" : "s"})`,
    onStart: (api) => {
      resetVm();
      emitTrace(api, null, "Program started");
    },
    onResume: (api) => {
      if (
        activeTimedId &&
        activeTimedMotors &&
        (activeTimedInstr?.kind === "drive" || activeTimedInstr?.kind === "turn")
      ) {
        const res = api.setDifferentialPower(
          activeTimedMotors.left,
          activeTimedMotors.right
        );
        currentLeft = res.leftPower;
        currentRight = res.rightPower;
      }
      emitTrace(api, activeTimedId, "Program resumed");
    },
    onTick: (ctx, api) => {
      latestTimestamp = ctx.timeSeconds;

      if (activeTimedId !== null) {
        if (ctx.isSingleStep) {
          finishActiveTimedBlock(api);
        } else {
          activeTimerRemaining -= ctx.dtSeconds;
          if (activeTimerRemaining > 1e-6) {
            return;
          }
          finishActiveTimedBlock(api);
        }
      }

      const outcome = stepInstructionPointer(api, Boolean(ctx.isSingleStep));
      if (outcome === "done") {
        api.completeProgram();
        emitTrace(api, null, "Routine completed");
      }
    },
    onStop: (api) => {
      resetVm();
      emitTrace(api, null, "Program stopped");
    },
  };
}
