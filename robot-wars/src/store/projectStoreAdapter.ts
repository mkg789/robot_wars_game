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

function buildSerializeInput(state: RobotStore) {
  const savedPrograms = loadSavedVisualPrograms();
  return {
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
  };
}

export function exportProjectFromStore(
  state: RobotStore = useRobotStore.getState()
): RobotWarsProject {
  return serializeRobotProject(buildSerializeInput(state));
}

export function exportProjectJsonFromStore(
  state: RobotStore = useRobotStore.getState()
): string {
  return stringifyRobotProject(buildSerializeInput(state));
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
