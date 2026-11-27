import type { FoundationConfig, RobotPart } from "../../robot-builder/types/robot.types";
import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type { ProjectLoadResult, RobotWarsProject } from "../types/project.types";
import { parseAndValidateRobotProject } from "./projectSerialization";

const PROJECT_AUTOSAVE_KEY = "robot-wars.project-autosave.v1";
const memoryFallback = new Map<string, string>();
let memoryUpdatedAtSeq = 0;
let localStorageUpdatedAtSeq = 0;
let saveSeqCounter = 0;

export interface AutosaveWriteResult {
  readonly saved: boolean;
  readonly persistedToLocalStorage?: boolean;
  readonly quotaExceeded?: boolean;
  readonly usedCompactFallback?: boolean;
  readonly warning?: string;
  readonly error?: string;
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

/**
 * Returns true only when the store state represents an intentionally built/modified robot
 * worth autosaving, preventing blank initial startups or untouched post-reset builds from
 * clobbering a recoverable previous session autosave.
 */
export function shouldPersistProjectAutosave(state: {
  readonly foundation: FoundationConfig | null;
  readonly parts: readonly RobotPart[];
  readonly connections: readonly unknown[];
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly historyPast: readonly unknown[];
}): boolean {
  if (!state.foundation) return false;
  if (state.foundation.confirmed) return true;
  if (state.historyPast.length > 0) return true;
  if (state.connections.length > 0 || state.electricalConnections.length > 0) {
    return true;
  }
  return state.parts.some(
    (p) =>
      p.id !== "foundation-chassis" &&
      p.id !== "foundation-top-plate" &&
      p.id !== "foundation-front-cover" &&
      !p.id.startsWith("foundation-member-")
  );
}

export function formatProjectFilename(projectName: string): string {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "robot-wars-project"}.robotwars.json`;
}

export function saveProjectAutosave(project: RobotWarsProject): AutosaveWriteResult {
  let serialized: string;
  try {
    serialized = JSON.stringify(project);
  } catch (err) {
    return {
      saved: false,
      persistedToLocalStorage: false,
      error: err instanceof Error ? err.message : "Failed to serialize autosave.",
    };
  }

  saveSeqCounter += 1;
  memoryFallback.set(PROJECT_AUTOSAVE_KEY, serialized);
  memoryUpdatedAtSeq = saveSeqCounter;

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(PROJECT_AUTOSAVE_KEY, serialized);
      localStorageUpdatedAtSeq = saveSeqCounter;
      return { saved: true, persistedToLocalStorage: true };
    } catch (err) {
      const quotaExceeded = isQuotaError(err);
      // If oversized embedded STL payloads tripped storage quota, retry with a compact
      // snapshot omitting base64 asset buffers so assembly/wiring/program stay recoverable.
      if (quotaExceeded && project.assets.length > 0) {
        try {
          const compactProject: RobotWarsProject = { ...project, assets: [] };
          const compactSerialized = JSON.stringify(compactProject);
          window.localStorage.setItem(PROJECT_AUTOSAVE_KEY, compactSerialized);
          localStorageUpdatedAtSeq = saveSeqCounter;
          return {
            saved: true,
            persistedToLocalStorage: true,
            quotaExceeded: true,
            usedCompactFallback: true,
            warning:
              "Browser storage quota reached: autosave kept robot structure and programs without embedded STL meshes (full copy retained in session memory).",
          };
        } catch (compactErr) {
          return {
            saved: false,
            persistedToLocalStorage: false,
            quotaExceeded: true,
            warning:
              "Browser localStorage quota exceeded; latest autosave is kept in session memory only.",
            error:
              compactErr instanceof Error
                ? compactErr.message
                : "Failed to persist autosave.",
          };
        }
      }
      return {
        saved: false,
        persistedToLocalStorage: false,
        quotaExceeded,
        warning: quotaExceeded
          ? "Browser localStorage quota exceeded; latest autosave is kept in session memory only."
          : "Browser localStorage write failed; latest autosave is kept in session memory only.",
        error: err instanceof Error ? err.message : "Failed to persist autosave.",
      };
    }
  }

  return { saved: true, persistedToLocalStorage: false };
}

export function hasProjectAutosave(): boolean {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (window.localStorage.getItem(PROJECT_AUTOSAVE_KEY) !== null) {
        return true;
      }
    }
  } catch {
    // Fall back to in-memory check
  }
  return memoryFallback.has(PROJECT_AUTOSAVE_KEY);
}

export function loadProjectAutosave(): ProjectLoadResult | null {
  let localRaw: string | null = null;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      localRaw = window.localStorage.getItem(PROJECT_AUTOSAVE_KEY);
    }
  } catch {
    localRaw = null;
  }
  const memoryRaw = memoryFallback.get(PROJECT_AUTOSAVE_KEY) ?? null;

  const raw =
    memoryRaw !== null && memoryUpdatedAtSeq > localStorageUpdatedAtSeq
      ? memoryRaw
      : (localRaw ?? memoryRaw);
  if (!raw) return null;
  return parseAndValidateRobotProject(raw);
}

export function clearProjectAutosave(): void {
  memoryFallback.delete(PROJECT_AUTOSAVE_KEY);
  memoryUpdatedAtSeq = 0;
  localStorageUpdatedAtSeq = 0;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(PROJECT_AUTOSAVE_KEY);
    }
  } catch {
    // No-op when storage unavailable
  }
}

export function downloadRobotProjectFile(
  project: RobotWarsProject,
  filename = formatProjectFilename(project.metadata.name)
): void {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readProjectFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsText(file);
  });
}
