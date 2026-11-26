import {
  parseAndValidateRobotProject,
  serializeRobotProject,
  stringifyRobotProject,
} from "../features/persistence/logic/projectSerialization";
import { loadSavedVisualPrograms } from "../features/programming/logic/programPersistence";
import type {
  ProjectLoadResult,
  RobotWarsProject,
} from "../features/persistence/types/project.types";
import { useRobotStore, type RobotStore } from "./robotStore";

export function exportProjectFromStore(
  state: RobotStore = useRobotStore.getState()
): RobotWarsProject {
  const savedPrograms = loadSavedVisualPrograms();
  return serializeRobotProject({
    projectName: state.projectName,
    createdAtIso: state.projectCreatedAtIso,
    stage: state.stage,
    foundationId: state.foundationId,
    foundation: state.foundation,
    parts: state.parts,
    connections: state.connections,
    electricalConnections: state.electricalConnections,
    drivetrain: state.drivetrain,
    hiddenPartIds: state.hiddenPartIds,
    selectedId: state.selectedId,
    selectedArenaId: state.selectedArenaId,
    visualProgram: state.visualProgram,
    savedPrograms: savedPrograms.length > 0 ? savedPrograms : undefined,
  });
}

export function exportProjectJsonFromStore(
  state: RobotStore = useRobotStore.getState()
): string {
  return stringifyRobotProject({
    projectName: state.projectName,
    createdAtIso: state.projectCreatedAtIso,
    stage: state.stage,
    foundationId: state.foundationId,
    foundation: state.foundation,
    parts: state.parts,
    connections: state.connections,
    electricalConnections: state.electricalConnections,
    drivetrain: state.drivetrain,
    hiddenPartIds: state.hiddenPartIds,
    selectedId: state.selectedId,
    selectedArenaId: state.selectedArenaId,
    visualProgram: state.visualProgram,
  });
}

export function importProjectIntoStore(
  rawJsonOrObject: string | unknown
): ProjectLoadResult {
  const parsed = parseAndValidateRobotProject(rawJsonOrObject);
  if (parsed.success && parsed.project) {
    useRobotStore.getState().loadProjectState(parsed);
  }
  return parsed;
}
