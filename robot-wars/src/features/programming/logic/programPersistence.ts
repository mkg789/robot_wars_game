import type {
  ProgramInstruction,
  VisualRobotProgram,
} from "../types/programWorkspace.types";
import { nextInstructionId } from "./programWorkspaceCompiler";

const STORAGE_KEY = "robot-wars.visual-programs.v1";
const memoryFallbackStore = new Map<string, string>();
const VALID_STOP_TARGETS = new Set(["robot", "both", "left", "right"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively validates a VisualRobotProgram instruction tree, rejecting malformed fields,
 * non-positive durations/thresholds/repeat counts, duplicate instruction IDs, and unknown sensorId references.
 */
export function isValidVisualInstruction(
  value: unknown,
  seenIds: Set<string> = new Set(),
  validSensorIds?: ReadonlySet<string>,
  depth = 0
): value is ProgramInstruction {
  if (depth > 32 || !isPlainRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    seenIds.has(value.id) ||
    typeof value.kind !== "string"
  ) {
    return false;
  }
  seenIds.add(value.id);

  switch (value.kind) {
    case "drive":
      return (
        (value.direction === "forward" || value.direction === "backward") &&
        typeof value.power === "number" &&
        Number.isFinite(value.power) &&
        typeof value.durationSeconds === "number" &&
        Number.isFinite(value.durationSeconds) &&
        value.durationSeconds > 0
      );
    case "turn":
      return (
        (value.direction === "left" || value.direction === "right") &&
        typeof value.power === "number" &&
        Number.isFinite(value.power) &&
        typeof value.durationSeconds === "number" &&
        Number.isFinite(value.durationSeconds) &&
        value.durationSeconds > 0
      );
    case "set-motors":
      return (
        typeof value.leftPower === "number" &&
        Number.isFinite(value.leftPower) &&
        typeof value.rightPower === "number" &&
        Number.isFinite(value.rightPower)
      );
    case "stop":
      return typeof value.target === "string" && VALID_STOP_TARGETS.has(value.target);
    case "wait":
      return (
        typeof value.durationSeconds === "number" &&
        Number.isFinite(value.durationSeconds) &&
        value.durationSeconds > 0
      );
    case "read-ultrasonic":
      if (value.sensorId !== undefined) {
        if (typeof value.sensorId !== "string" || value.sensorId.length === 0) {
          return false;
        }
        if (validSensorIds && !validSensorIds.has(value.sensorId)) {
          return false;
        }
      }
      return true;
    case "if-ultrasonic":
      if (value.sensorId !== undefined) {
        if (typeof value.sensorId !== "string" || value.sensorId.length === 0) {
          return false;
        }
        if (validSensorIds && !validSensorIds.has(value.sensorId)) {
          return false;
        }
      }
      return (
        (value.operator === "below" || value.operator === "above") &&
        typeof value.thresholdMeters === "number" &&
        Number.isFinite(value.thresholdMeters) &&
        value.thresholdMeters > 0 &&
        Array.isArray(value.thenInstructions) &&
        value.thenInstructions.every((inst) =>
          isValidVisualInstruction(inst, seenIds, validSensorIds, depth + 1)
        ) &&
        Array.isArray(value.elseInstructions) &&
        value.elseInstructions.every((inst) =>
          isValidVisualInstruction(inst, seenIds, validSensorIds, depth + 1)
        )
      );
    case "repeat":
      return (
        typeof value.count === "number" &&
        Number.isInteger(value.count) &&
        value.count >= 1 &&
        value.count <= 50 &&
        Array.isArray(value.bodyInstructions) &&
        value.bodyInstructions.every((inst) =>
          isValidVisualInstruction(inst, seenIds, validSensorIds, depth + 1)
        )
      );
    default:
      return false;
  }
}

export function validateVisualProgramPayload(
  value: unknown,
  validSensorIds?: ReadonlySet<string>
): VisualRobotProgram | null {
  if (!isPlainRecord(value)) return null;
  if (
    value.version !== 1 ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.name !== "string" ||
    !Array.isArray(value.instructions)
  ) {
    return null;
  }
  const seenIds = new Set<string>();
  if (
    !value.instructions.every((inst) =>
      isValidVisualInstruction(inst, seenIds, validSensorIds)
    )
  ) {
    return null;
  }
  return structuredClone({
    version: 1,
    id: value.id,
    name: value.name,
    updatedAtIso:
      typeof value.updatedAtIso === "string"
        ? value.updatedAtIso
        : new Date().toISOString(),
    instructions: value.instructions,
  });
}

function readStorage(): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(STORAGE_KEY);
    }
  } catch {
    // Fallback cleanly when localStorage is restricted
  }
  return memoryFallbackStore.get(STORAGE_KEY) ?? null;
}

function writeStorage(payload: string): void {
  memoryFallbackStore.set(STORAGE_KEY, payload);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, payload);
    }
  } catch {
    // Fallback remains intact in memory
  }
}

export function clearVisualProgramStorage(): void {
  memoryFallbackStore.delete(STORAGE_KEY);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // No-op
  }
}

export function createStarterPresets(): readonly VisualRobotProgram[] {
  const now = new Date().toISOString();
  return [
    {
      version: 1,
      id: "preset-box-drive",
      name: "Repeat Drive & Turn Loop",
      updatedAtIso: now,
      instructions: [
        {
          id: "preset-rep-1",
          kind: "repeat",
          count: 2,
          bodyInstructions: [
            {
              id: "preset-drv-1",
              kind: "drive",
              direction: "forward",
              power: 0.65,
              durationSeconds: 1.2,
            },
            {
              id: "preset-trn-1",
              kind: "turn",
              direction: "right",
              power: 0.55,
              durationSeconds: 0.7,
            },
          ],
        },
        {
          id: "preset-stp-1",
          kind: "stop",
          target: "robot",
        },
      ],
    },
    {
      version: 1,
      id: "preset-sensor-check",
      name: "Ultrasonic Guard Branch",
      updatedAtIso: now,
      instructions: [
        {
          id: "preset-read-1",
          kind: "read-ultrasonic",
        },
        {
          id: "preset-if-1",
          kind: "if-ultrasonic",
          operator: "below",
          thresholdMeters: 1.2,
          thenInstructions: [
            { id: "preset-if-stop", kind: "stop", target: "robot" },
          ],
          elseInstructions: [
            {
              id: "preset-if-drv",
              kind: "drive",
              direction: "forward",
              power: 0.6,
              durationSeconds: 1.5,
            },
          ],
        },
      ],
    },
  ];
}

export function createEmptyVisualProgram(name = "My Robot Routine"): VisualRobotProgram {
  return {
    version: 1,
    id: nextInstructionId("prog"),
    name,
    updatedAtIso: new Date().toISOString(),
    instructions: [],
  };
}

export function loadSavedVisualPrograms(): VisualRobotProgram[] {
  const raw = readStorage();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => validateVisualProgramPayload(p))
      .filter((p): p is VisualRobotProgram => p !== null);
  } catch {
    return [];
  }
}

export function replaceSavedVisualPrograms(
  programs: readonly VisualRobotProgram[]
): VisualRobotProgram[] {
  const deduped: VisualRobotProgram[] = [];
  const seenIds = new Set<string>();
  for (const item of programs) {
    const validated = validateVisualProgramPayload(item);
    if (!validated || seenIds.has(validated.id)) continue;
    seenIds.add(validated.id);
    deduped.push(validated);
  }
  writeStorage(JSON.stringify(deduped));
  return deduped;
}

export function saveVisualProgram(program: VisualRobotProgram): VisualRobotProgram[] {
  const existing = loadSavedVisualPrograms();
  const updated: VisualRobotProgram = {
    ...program,
    updatedAtIso: new Date().toISOString(),
  };
  const nextList = [
    ...existing.filter((p) => p.id !== updated.id),
    updated,
  ];
  writeStorage(JSON.stringify(nextList));
  return nextList;
}

export function deleteSavedVisualProgram(programId: string): VisualRobotProgram[] {
  const nextList = loadSavedVisualPrograms().filter((p) => p.id !== programId);
  writeStorage(JSON.stringify(nextList));
  return nextList;
}
