import { createStarterPresets } from "../../programming/logic/programPersistence";
import { SIMULATION_ARENA_PRESETS } from "../../simulation/logic/simulationWorld";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  PROJECT_FORMAT_ID,
  type LegacyRobotWarsProjectV1,
} from "../types/project.types";

export interface ProjectMigrationResult {
  readonly success: boolean;
  readonly payload: Record<string, unknown> | null;
  readonly migratedFromVersion?: number;
  readonly warnings: string[];
  readonly errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates version header and migrates legacy Robot Wars project payloads
 * deterministically to CURRENT_PROJECT_SCHEMA_VERSION.
 */
export function migrateProjectPayload(raw: unknown): ProjectMigrationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return {
      success: false,
      payload: null,
      warnings,
      errors: ["Project file must be a JSON object."],
    };
  }

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return {
      success: false,
      payload: null,
      warnings,
      errors: ["Missing or invalid numeric project 'schemaVersion'."],
    };
  }

  if (schemaVersion > CURRENT_PROJECT_SCHEMA_VERSION) {
    return {
      success: false,
      payload: null,
      warnings,
      errors: [
        `Unsupported project schemaVersion ${schemaVersion}. This build supports up to schemaVersion ${CURRENT_PROJECT_SCHEMA_VERSION}.`,
      ],
    };
  }

  // Validate format header when present (or required in v2+)
  if (schemaVersion >= 2 && raw.format !== PROJECT_FORMAT_ID) {
    return {
      success: false,
      payload: null,
      warnings,
      errors: [
        `Invalid project format '${String(raw.format ?? "")}'; expected '${PROJECT_FORMAT_ID}'.`,
      ],
    };
  }
  if (raw.format !== undefined && raw.format !== PROJECT_FORMAT_ID) {
    return {
      success: false,
      payload: null,
      warnings,
      errors: [
        `Unrecognized project format '${String(raw.format)}'; expected '${PROJECT_FORMAT_ID}'.`,
      ],
    };
  }

  if (schemaVersion === CURRENT_PROJECT_SCHEMA_VERSION) {
    return {
      success: true,
      payload: raw,
      warnings,
      errors,
    };
  }

  // Migrate Schema v1 -> v2
  const v1 = raw as unknown as LegacyRobotWarsProjectV1;
  const nowIso = new Date().toISOString();
  const starterProgram = createStarterPresets()[0];

  const migratedV2: Record<string, unknown> = {
    format: PROJECT_FORMAT_ID,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    metadata: {
      name:
        typeof v1.name === "string" && v1.name.trim().length > 0
          ? v1.name.trim()
          : "Migrated Robot Project",
      createdAtIso: typeof v1.createdAtIso === "string" ? v1.createdAtIso : nowIso,
      updatedAtIso: typeof v1.updatedAtIso === "string" ? v1.updatedAtIso : nowIso,
      appName: "Robot Wars",
    },
    build: {
      stage: v1.stage ?? "foundation",
      foundationId: v1.foundationId ?? null,
      foundation: v1.foundation ?? null,
      parts: Array.isArray(v1.parts) ? v1.parts : [],
      connections: Array.isArray(v1.connections) ? v1.connections : [],
      drivetrain: v1.drivetrain ?? {
        type: "differential-2",
        left: [null],
        right: [null],
        mappingCustomized: false,
      },
      hiddenPartIds: Array.isArray(v1.hiddenPartIds) ? v1.hiddenPartIds : [],
      selectedId: v1.selectedId ?? null,
    },
    electrical: {
      connections: Array.isArray(v1.electricalConnections)
        ? v1.electricalConnections
        : [],
    },
    simulation: {
      selectedArenaId:
        typeof v1.selectedArenaId === "string"
          ? v1.selectedArenaId
          : SIMULATION_ARENA_PRESETS[0].id,
    },
    programming: {
      activeProgram: v1.visualProgram ?? starterProgram,
    },
    assets: Array.isArray(v1.assets) ? v1.assets : [],
  };

  warnings.push("Migrated legacy v1 project file to schemaVersion 2.");
  return {
    success: true,
    payload: migratedV2,
    migratedFromVersion: 1,
    warnings,
    errors,
  };
}
