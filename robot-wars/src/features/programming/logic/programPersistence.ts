import type { VisualRobotProgram } from "../types/programWorkspace.types";
import { nextInstructionId } from "./programWorkspaceCompiler";

const STORAGE_KEY = "robot-wars.visual-programs.v1";
const memoryFallbackStore = new Map<string, string>();

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
    return parsed.filter(
      (p): p is VisualRobotProgram =>
        Boolean(p) &&
        typeof p === "object" &&
        p.version === 1 &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        Array.isArray(p.instructions)
    );
  } catch {
    return [];
  }
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
