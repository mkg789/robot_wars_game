import type { ProjectLoadResult, RobotWarsProject } from "../types/project.types";
import { parseAndValidateRobotProject } from "./projectSerialization";

const PROJECT_AUTOSAVE_KEY = "robot-wars.project-autosave.v1";
const memoryFallback = new Map<string, string>();

export interface AutosaveWriteResult {
  readonly saved: boolean;
  readonly error?: string;
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
  try {
    const serialized = JSON.stringify(project);
    memoryFallback.set(PROJECT_AUTOSAVE_KEY, serialized);
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(PROJECT_AUTOSAVE_KEY, serialized);
    }
    return { saved: true };
  } catch (err) {
    return {
      saved: false,
      error: err instanceof Error ? err.message : "Failed to persist autosave.",
    };
  }
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
  let raw: string | null = null;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      raw = window.localStorage.getItem(PROJECT_AUTOSAVE_KEY);
    }
  } catch {
    raw = null;
  }
  if (raw === null) {
    raw = memoryFallback.get(PROJECT_AUTOSAVE_KEY) ?? null;
  }
  if (!raw) return null;
  return parseAndValidateRobotProject(raw);
}

export function clearProjectAutosave(): void {
  memoryFallback.delete(PROJECT_AUTOSAVE_KEY);
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
