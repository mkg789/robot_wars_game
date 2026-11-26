import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import { createStarterPresets } from "../../programming/logic/programPersistence";
import type {
  ProgramInstruction,
  VisualRobotProgram,
} from "../../programming/types/programWorkspace.types";
import {
  collectSnapshotMeshAssetIds,
  sanitizeAssemblyGraph,
  syncAssemblyTransforms,
} from "../../robot-builder/logic/assemblyGraphSanitizer";
import {
  decodeFloat32ArrayBase64,
  encodeFloat32ArrayBase64,
  getMeshAssetRecord,
  restoreMeshAssetRecord,
} from "../../robot-builder/logic/meshAssetRegistry";
import type {
  BuildStage,
  DrivetrainAssignment,
  DrivetrainConfiguration,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../../robot-builder/types/robot.types";
import { SIMULATION_ARENA_PRESETS } from "../../simulation/logic/simulationWorld";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  PROJECT_FORMAT_ID,
  type DecodedMeshAssetPayload,
  type ProjectLoadResult,
  type ProjectSerializeInput,
  type RobotWarsProject,
  type SerializedMeshAsset,
} from "../types/project.types";
import { migrateProjectPayload } from "./projectMigrations";

const VALID_BUILD_STAGES: ReadonlySet<BuildStage> = new Set([
  "foundation",
  "structure",
  "battery",
  "controller",
  "motors",
  "wheels",
  "drivetrain",
  "completed",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteTuple3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isValidInstruction(value: unknown, depth = 0): value is ProgramInstruction {
  if (depth > 32 || !isPlainObject(value)) return false;
  if (typeof value.id !== "string" || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "drive":
    case "turn":
      return (
        typeof value.power === "number" &&
        Number.isFinite(value.power) &&
        typeof value.durationSeconds === "number" &&
        Number.isFinite(value.durationSeconds)
      );
    case "set-motors":
      return (
        typeof value.leftPower === "number" &&
        Number.isFinite(value.leftPower) &&
        typeof value.rightPower === "number" &&
        Number.isFinite(value.rightPower)
      );
    case "stop":
      return typeof value.target === "string";
    case "wait":
      return typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds);
    case "read-ultrasonic":
      return true;
    case "if-ultrasonic":
      return (
        typeof value.thresholdMeters === "number" &&
        Number.isFinite(value.thresholdMeters) &&
        Array.isArray(value.thenInstructions) &&
        value.thenInstructions.every((inst) => isValidInstruction(inst, depth + 1)) &&
        Array.isArray(value.elseInstructions) &&
        value.elseInstructions.every((inst) => isValidInstruction(inst, depth + 1))
      );
    case "repeat":
      return (
        typeof value.count === "number" &&
        Number.isFinite(value.count) &&
        Array.isArray(value.bodyInstructions) &&
        value.bodyInstructions.every((inst) => isValidInstruction(inst, depth + 1))
      );
    default:
      return false;
  }
}

function validateVisualProgramPayload(value: unknown): VisualRobotProgram | null {
  if (!isPlainObject(value)) return null;
  if (
    value.version !== 1 ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !Array.isArray(value.instructions)
  ) {
    return null;
  }
  if (!value.instructions.every((inst) => isValidInstruction(inst))) {
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

function validateDrivetrainPayload(
  raw: unknown,
  warnings: string[]
): DrivetrainConfiguration {
  const defaultConfig: DrivetrainConfiguration = {
    type: "differential-2",
    left: [null],
    right: [null],
    mappingCustomized: false,
  };
  if (!isPlainObject(raw)) {
    warnings.push("Missing or malformed drivetrain configuration; reset to 2-wheel default.");
    return defaultConfig;
  }
  const type =
    raw.type === "differential-4" ? "differential-4" : "differential-2";
  if (raw.type !== "differential-2" && raw.type !== "differential-4") {
    warnings.push(`Unknown drivetrain type '${String(raw.type)}'; defaulted to differential-2.`);
  }
  const slotCount = type === "differential-4" ? 2 : 1;
  const sanitizeSide = (list: unknown): Array<DrivetrainAssignment | null> => {
    const arr = Array.isArray(list) ? list : [];
    return Array.from({ length: slotCount }, (_, idx) => {
      const slot = arr[idx];
      if (
        isPlainObject(slot) &&
        typeof slot.motorId === "string" &&
        typeof slot.wheelId === "string"
      ) {
        return { motorId: slot.motorId, wheelId: slot.wheelId };
      }
      return null;
    });
  };
  return {
    type,
    left: sanitizeSide(raw.left),
    right: sanitizeSide(raw.right),
    mappingCustomized: Boolean(raw.mappingCustomized),
  };
}

function validatePartRecord(raw: unknown): raw is RobotPart {
  if (!isPlainObject(raw)) return false;
  return (
    typeof raw.id === "string" &&
    raw.id.length > 0 &&
    typeof raw.name === "string" &&
    typeof raw.type === "string" &&
    isFiniteTuple3(raw.position) &&
    isFiniteTuple3(raw.rotation) &&
    isFiniteTuple3(raw.size) &&
    typeof raw.mass === "number" &&
    Number.isFinite(raw.mass)
  );
}

/**
 * Serializes complete Robot Wars project state (assembly graph, electrical wiring,
 * simulation arena setting, active visual program, and deduplicated STL assets).
 */
export function serializeRobotProject(
  input: ProjectSerializeInput
): RobotWarsProject {
  const nowIso = new Date().toISOString();
  const assetIds = new Set<string>();
  collectSnapshotMeshAssetIds(input.parts, input.foundation, assetIds);

  const assets: SerializedMeshAsset[] = [];
  for (const assetId of assetIds) {
    const rec = getMeshAssetRecord(assetId);
    if (!rec) continue;
    assets.push({
      assetId: rec.assetId,
      fileName: rec.inspection.fileName,
      inspection: structuredClone(rec.inspection),
      centeredPositionsBase64: encodeFloat32ArrayBase64(rec.centeredPositions),
      normalsBase64: encodeFloat32ArrayBase64(rec.normals),
    });
  }

  return {
    format: PROJECT_FORMAT_ID,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    metadata: {
      name: input.projectName.trim() || "Untitled Robot",
      createdAtIso: input.createdAtIso ?? nowIso,
      updatedAtIso: nowIso,
      appName: "Robot Wars",
    },
    build: {
      stage: input.stage,
      foundationId: input.foundationId,
      foundation: input.foundation ? structuredClone(input.foundation) : null,
      parts: structuredClone([...input.parts]),
      connections: structuredClone([...input.connections]),
      drivetrain: structuredClone(input.drivetrain),
      hiddenPartIds: [...input.hiddenPartIds],
      selectedId: input.selectedId,
    },
    electrical: {
      connections: structuredClone([...input.electricalConnections]),
    },
    simulation: {
      selectedArenaId: input.selectedArenaId,
    },
    programming: {
      activeProgram: structuredClone(input.visualProgram),
      ...(input.savedPrograms && input.savedPrograms.length > 0
        ? { savedPrograms: structuredClone([...input.savedPrograms]) }
        : {}),
    },
    assets,
  };
}

export function stringifyRobotProject(input: ProjectSerializeInput): string {
  return JSON.stringify(serializeRobotProject(input), null, 2);
}

/**
 * Parses, migrates, validates, and sanitizes a serialized Robot Wars project JSON string or object
 * without mutating global stores or STL registries.
 */
export function parseAndValidateRobotProject(
  rawInput: string | unknown
): ProjectLoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown = rawInput;
  if (typeof rawInput === "string") {
    try {
      parsed = JSON.parse(rawInput);
    } catch (err) {
      return {
        success: false,
        project: null,
        decodedAssets: [],
        restoredAssetIds: [],
        orphanedAssetIds: [],
        warnings,
        errors: [
          `Invalid JSON project file: ${err instanceof Error ? err.message : "parse error"}.`,
        ],
      };
    }
  }

  const migration = migrateProjectPayload(parsed);
  warnings.push(...migration.warnings);
  if (!migration.success || !migration.payload) {
    return {
      success: false,
      project: null,
      decodedAssets: [],
      restoredAssetIds: [],
      orphanedAssetIds: [],
      migratedFromVersion: migration.migratedFromVersion,
      warnings,
      errors: migration.errors,
    };
  }

  const v2 = migration.payload;
  const rawMetadata = isPlainObject(v2.metadata) ? v2.metadata : {};
  const rawBuild = isPlainObject(v2.build) ? v2.build : null;
  if (!rawBuild) {
    errors.push("Project file is missing required 'build' section.");
    return {
      success: false,
      project: null,
      decodedAssets: [],
      restoredAssetIds: [],
      orphanedAssetIds: [],
      migratedFromVersion: migration.migratedFromVersion,
      warnings,
      errors,
    };
  }

  if (!Array.isArray(rawBuild.parts)) {
    errors.push("Project 'build.parts' must be an array.");
    return {
      success: false,
      project: null,
      decodedAssets: [],
      restoredAssetIds: [],
      orphanedAssetIds: [],
      migratedFromVersion: migration.migratedFromVersion,
      warnings,
      errors,
    };
  }

  const validParts: RobotPart[] = [];
  for (const candidate of rawBuild.parts) {
    if (validatePartRecord(candidate)) {
      validParts.push(structuredClone(candidate));
    } else {
      warnings.push("Skipped a corrupted component entry during project load.");
    }
  }
  if (rawBuild.parts.length > 0 && validParts.length === 0) {
    errors.push("All components in 'build.parts' failed schema validation.");
    return {
      success: false,
      project: null,
      decodedAssets: [],
      restoredAssetIds: [],
      orphanedAssetIds: [],
      migratedFromVersion: migration.migratedFromVersion,
      warnings,
      errors,
    };
  }

  const rawConnections = Array.isArray(rawBuild.connections) ? rawBuild.connections : [];
  if (!Array.isArray(rawBuild.connections)) {
    warnings.push("Missing 'build.connections'; defaulted to empty connection list.");
  }

  const rawFoundation = isPlainObject(rawBuild.foundation)
    ? (structuredClone(rawBuild.foundation) as FoundationConfig)
    : null;
  if (rawBuild.foundation !== null && rawBuild.foundation !== undefined && !rawFoundation) {
    warnings.push("Invalid 'build.foundation' payload; ignored.");
  }

  const rawElectrical = isPlainObject(v2.electrical) ? v2.electrical : {};
  const rawElectricalConnections: ElectricalConnection[] = Array.isArray(
    rawElectrical.connections
  )
    ? structuredClone(
        rawElectrical.connections.filter(
          (c): c is ElectricalConnection =>
            isPlainObject(c) &&
            typeof c.id === "string" &&
            typeof c.sourcePartId === "string" &&
            typeof c.targetPartId === "string" &&
            typeof c.sourceInterfaceId === "string" &&
            typeof c.targetInterfaceId === "string"
        )
      )
    : [];

  if (
    Array.isArray(rawElectrical.connections) &&
    rawElectricalConnections.length < rawElectrical.connections.length
  ) {
    warnings.push("Skipped one or more malformed electrical connection entries.");
  }

  // Decode & validate STL assets before graph sanitization
  const rawAssets = Array.isArray(v2.assets) ? v2.assets : [];
  const decodedAssets: DecodedMeshAssetPayload[] = [];
  const seenDecodedIds = new Set<string>();
  for (const item of rawAssets) {
    if (
      !isPlainObject(item) ||
      typeof item.assetId !== "string" ||
      typeof item.centeredPositionsBase64 !== "string" ||
      typeof item.normalsBase64 !== "string" ||
      !isPlainObject(item.inspection) ||
      typeof item.inspection.fileName !== "string" ||
      typeof item.inspection.triangleCount !== "number"
    ) {
      warnings.push("Skipped malformed embedded STL asset entry.");
      continue;
    }
    if (seenDecodedIds.has(item.assetId)) continue;
    try {
      const centeredPositions = decodeFloat32ArrayBase64(item.centeredPositionsBase64);
      const normals = decodeFloat32ArrayBase64(item.normalsBase64);
      if (centeredPositions.length % 9 !== 0 || centeredPositions.length !== normals.length) {
        warnings.push(
          `Skipped STL asset '${item.assetId}' due to invalid vertex/normal buffer dimensions.`
        );
        continue;
      }
      seenDecodedIds.add(item.assetId);
      decodedAssets.push({
        assetId: item.assetId,
        centeredPositions,
        normals,
        inspection: structuredClone(
          item.inspection
        ) as unknown as DecodedMeshAssetPayload["inspection"],
      });
    } catch (err) {
      warnings.push(
        `Failed to decode STL asset '${item.assetId}': ${
          err instanceof Error ? err.message : "invalid buffer"
        }.`
      );
    }
  }

  // Run assembly transform sync + graph sanitization
  const validatedDrivetrain = validateDrivetrainPayload(rawBuild.drivetrain, warnings);
  const rawStage =
    typeof rawBuild.stage === "string" && VALID_BUILD_STAGES.has(rawBuild.stage as BuildStage)
      ? (rawBuild.stage as BuildStage)
      : "foundation";
  const hiddenPartIds = Array.isArray(rawBuild.hiddenPartIds)
    ? rawBuild.hiddenPartIds.filter((id): id is string => typeof id === "string")
    : [];
  const rawSelectedId =
    typeof rawBuild.selectedId === "string" ? rawBuild.selectedId : null;
  const rawFoundationId =
    typeof rawBuild.foundationId === "string" ? rawBuild.foundationId : null;

  const syncedParts = syncAssemblyTransforms(
    validParts,
    rawConnections as RobotConnection[]
  );
  const sanitized = sanitizeAssemblyGraph({
    parts: syncedParts,
    connections: rawConnections as RobotConnection[],
    electricalConnections: rawElectricalConnections,
    foundation: rawFoundation,
    foundationId: rawFoundationId,
    drivetrain: validatedDrivetrain,
    hiddenPartIds,
    selectedId: rawSelectedId,
    selectedWheelMotorId: null,
    selectedElectricalConnectionId: null,
    selectedElectricalPinId: null,
    stage: rawStage,
  });

  if (sanitized.connections.length < rawConnections.length) {
    warnings.push(
      `Removed ${rawConnections.length - sanitized.connections.length} invalid or cyclic mechanical connection(s) during graph sanitization.`
    );
  }
  if (sanitized.electricalConnections.length < rawElectricalConnections.length) {
    warnings.push(
      `Removed ${
        rawElectricalConnections.length - sanitized.electricalConnections.length
      } dangling electrical wire(s) whose endpoints or interfaces no longer exist.`
    );
  }

  // Check for referenced STL assets that were not bundled in file or already registered
  const referencedAssetIds = new Set<string>();
  collectSnapshotMeshAssetIds(sanitized.parts, sanitized.foundation, referencedAssetIds);
  const orphanedAssetIds: string[] = [];
  for (const refId of referencedAssetIds) {
    if (!seenDecodedIds.has(refId) && !getMeshAssetRecord(refId)) {
      orphanedAssetIds.push(refId);
    }
  }
  if (orphanedAssetIds.length > 0) {
    warnings.push(
      `Referenced STL geometry missing for ${orphanedAssetIds.length} asset(s) (${orphanedAssetIds.join(", ")}); placeholder bounds geometry will render until re-imported.`
    );
  }

  // Validate arena selection & visual program
  const rawSim = isPlainObject(v2.simulation) ? v2.simulation : {};
  const requestedArenaId =
    typeof rawSim.selectedArenaId === "string" ? rawSim.selectedArenaId : "";
  const validArena = SIMULATION_ARENA_PRESETS.find((p) => p.id === requestedArenaId);
  const selectedArenaId = validArena
    ? validArena.id
    : SIMULATION_ARENA_PRESETS[0].id;
  if (requestedArenaId && !validArena) {
    warnings.push(
      `Arena preset '${requestedArenaId}' is unavailable; defaulted to '${selectedArenaId}'.`
    );
  }

  const rawProg = isPlainObject(v2.programming) ? v2.programming : {};
  const validatedActiveProgram = validateVisualProgramPayload(rawProg.activeProgram);
  const activeProgram = validatedActiveProgram ?? createStarterPresets()[0];
  if (rawProg.activeProgram !== undefined && !validatedActiveProgram) {
    warnings.push("Saved visual program failed validation; reverted to starter preset.");
  }

  const savedPrograms = Array.isArray(rawProg.savedPrograms)
    ? rawProg.savedPrograms
        .map((p) => validateVisualProgramPayload(p))
        .filter((p): p is VisualRobotProgram => p !== null)
    : undefined;

  const nowIso = new Date().toISOString();
  const projectName =
    typeof rawMetadata.name === "string" && rawMetadata.name.trim().length > 0
      ? rawMetadata.name.trim()
      : "Untitled Robot";

  const normalizedProject: RobotWarsProject = {
    format: PROJECT_FORMAT_ID,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    metadata: {
      name: projectName,
      createdAtIso:
        typeof rawMetadata.createdAtIso === "string" ? rawMetadata.createdAtIso : nowIso,
      updatedAtIso:
        typeof rawMetadata.updatedAtIso === "string" ? rawMetadata.updatedAtIso : nowIso,
      appName: "Robot Wars",
    },
    build: {
      stage: sanitized.stage ?? rawStage,
      foundationId: sanitized.foundationId,
      foundation: sanitized.foundation,
      parts: sanitized.parts,
      connections: sanitized.connections,
      drivetrain: sanitized.drivetrain,
      hiddenPartIds: sanitized.hiddenPartIds,
      selectedId: sanitized.selectedId,
    },
    electrical: {
      connections: sanitized.electricalConnections,
    },
    simulation: {
      selectedArenaId,
    },
    programming: {
      activeProgram,
      ...(savedPrograms && savedPrograms.length > 0 ? { savedPrograms } : {}),
    },
    assets: rawAssets.filter((item): item is SerializedMeshAsset =>
      decodedAssets.some((d) => isPlainObject(item) && item.assetId === d.assetId)
    ),
  };

  return {
    success: true,
    project: normalizedProject,
    decodedAssets,
    restoredAssetIds: decodedAssets.map((a) => a.assetId),
    orphanedAssetIds,
    migratedFromVersion: migration.migratedFromVersion,
    warnings,
    errors,
  };
}

/**
 * Registers decoded STL buffers into meshAssetRegistry so the store can retain them.
 */
export function registerDecodedProjectAssets(
  decodedAssets: readonly DecodedMeshAssetPayload[]
): void {
  for (const asset of decodedAssets) {
    restoreMeshAssetRecord({
      assetId: asset.assetId,
      centeredPositions: asset.centeredPositions,
      normals: asset.normals,
      inspection: asset.inspection,
    });
  }
}
