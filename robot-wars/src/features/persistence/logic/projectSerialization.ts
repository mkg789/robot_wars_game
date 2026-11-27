import type {
  ElectricalConnection,
  ElectricalConnectionKind,
} from "../../electrical/types/electrical.types";
import {
  createStarterPresets,
  validateVisualProgramPayload,
} from "../../programming/logic/programPersistence";
import { resolveRobotSensors } from "../../programming/logic/sensorResolver";
import type { VisualRobotProgram } from "../../programming/types/programWorkspace.types";
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
  ComponentType,
  CustomCollisionBox,
  CustomCollisionMode,
  DrivetrainAssignment,
  DrivetrainConfiguration,
  FoundationConfig,
  ImportedMeshTransform,
  RobotConnection,
  RobotPart,
  StlLengthUnit,
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
import { migrateProjectPayload, stripUnsafeObjectKeys } from "./projectMigrations";

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

const VALID_COMPONENT_TYPES: ReadonlySet<ComponentType> = new Set([
  "Armor Plate",
  "Structural Block",
  "Front Bumper",
  "Wheel",
  "Motor",
  "Battery",
  "Controller",
]);

const VALID_STL_UNITS: ReadonlySet<StlLengthUnit> = new Set([
  "mm",
  "cm",
  "m",
  "in",
]);

const VALID_COLLISION_MODES: ReadonlySet<CustomCollisionMode> = new Set([
  "bounding-box",
  "single-box",
  "multi-box",
  "convex-approx",
]);

const VALID_ELECTRICAL_KINDS: ReadonlySet<ElectricalConnectionKind> = new Set([
  "power",
  "ground",
  "signal",
  "pwm",
  "bus",
  "passive",
  "unspecified",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteTuple3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isPositiveTuple3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => isPositiveFinite(n))
  );
}

function isNonNegativeTuple3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => isNonNegativeFinite(n))
  );
}

function isValidGeometry(raw: unknown): boolean {
  if (!isPlainObject(raw)) return false;
  if (raw.shape === "box") {
    return (
      isPositiveFinite(raw.length) &&
      isPositiveFinite(raw.height) &&
      isPositiveFinite(raw.width)
    );
  }
  if (raw.shape === "cylinder") {
    return (
      isPositiveFinite(raw.diameter) &&
      isPositiveFinite(raw.axialWidth) &&
      (raw.axis === "x" || raw.axis === "y" || raw.axis === "z")
    );
  }
  return false;
}

function isValidMeshTransform(raw: unknown): raw is ImportedMeshTransform {
  if (!isPlainObject(raw)) return false;
  return (
    typeof raw.unit === "string" &&
    VALID_STL_UNITS.has(raw.unit as StlLengthUnit) &&
    (raw.scaleMode === "uniform" || raw.scaleMode === "non-uniform") &&
    isPositiveFinite(raw.uniformScale) &&
    isPositiveTuple3(raw.nonUniformScale) &&
    isFiniteTuple3(raw.orientationRotation) &&
    isFiniteTuple3(raw.positionOffset)
  );
}

function isValidCollisionConfig(raw: unknown): boolean {
  if (!isPlainObject(raw)) return false;
  if (
    typeof raw.mode !== "string" ||
    !VALID_COLLISION_MODES.has(raw.mode as CustomCollisionMode) ||
    !Array.isArray(raw.boxes) ||
    !isPositiveTuple3(raw.envelopeSize) ||
    !isFiniteTuple3(raw.envelopeCenter) ||
    !isPlainObject(raw.planarFootprint) ||
    !isPositiveFinite(raw.planarFootprint.lengthM) ||
    !isPositiveFinite(raw.planarFootprint.widthM)
  ) {
    return false;
  }
  return raw.boxes.every(
    (b: unknown): b is CustomCollisionBox =>
      isPlainObject(b) &&
      typeof b.id === "string" &&
      b.id.length > 0 &&
      isFiniteTuple3(b.center) &&
      isPositiveTuple3(b.size)
  );
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

function validateFoundationPayload(
  raw: unknown,
  warnings: string[]
): FoundationConfig | null {
  if (raw === null || raw === undefined) return null;
  if (!isPlainObject(raw)) {
    warnings.push("Invalid 'build.foundation' payload; ignored.");
    return null;
  }
  if (
    typeof raw.modelId !== "string" ||
    raw.modelId.length === 0 ||
    !isPositiveFinite(raw.length) ||
    !isPositiveFinite(raw.width) ||
    !isPositiveFinite(raw.height)
  ) {
    warnings.push("Invalid 'build.foundation' dimensions or modelId; ignored.");
    return null;
  }
  const mode =
    raw.mode === undefined || raw.mode === "procedural" || raw.mode === "imported"
      ? raw.mode
      : undefined;
  if (raw.mode !== undefined && !mode) {
    warnings.push("Unknown 'build.foundation.mode'; ignored foundation payload.");
    return null;
  }
  if (mode === "imported") {
    if (
      !isPlainObject(raw.imported) ||
      typeof raw.imported.assetId !== "string" ||
      !isValidMeshTransform(raw.imported.transform) ||
      !isValidCollisionConfig(raw.imported.collision)
    ) {
      warnings.push("Invalid imported STL foundation metadata; ignored foundation payload.");
      return null;
    }
  }
  if (raw.procedural !== undefined) {
    if (
      !isPlainObject(raw.procedural) ||
      !isPositiveFinite(raw.procedural.length) ||
      !isPositiveFinite(raw.procedural.width) ||
      !isPositiveFinite(raw.procedural.height)
    ) {
      warnings.push("Invalid procedural foundation dimensions; ignored foundation payload.");
      return null;
    }
  }
  return structuredClone(raw) as unknown as FoundationConfig;
}

function validatePartRecord(raw: unknown): raw is RobotPart {
  if (!isPlainObject(raw)) return false;
  if (
    typeof raw.id !== "string" ||
    raw.id.length === 0 ||
    typeof raw.name !== "string" ||
    typeof raw.type !== "string" ||
    !VALID_COMPONENT_TYPES.has(raw.type as ComponentType) ||
    !isFiniteTuple3(raw.position) ||
    !isFiniteTuple3(raw.rotation) ||
    !isPositiveTuple3(raw.size) ||
    !isNonNegativeFinite(raw.mass)
  ) {
    return false;
  }
  if (raw.massKg !== undefined && !isNonNegativeFinite(raw.massKg)) return false;
  if (raw.color !== undefined && typeof raw.color !== "string") return false;
  if (raw.wheelDiameter !== undefined && !isPositiveFinite(raw.wheelDiameter)) {
    return false;
  }
  if (raw.wheelWidth !== undefined && !isPositiveFinite(raw.wheelWidth)) {
    return false;
  }
  if (raw.geometry !== undefined && !isValidGeometry(raw.geometry)) {
    return false;
  }
  if (raw.meshTransform !== undefined && !isValidMeshTransform(raw.meshTransform)) {
    return false;
  }
  if (raw.collisionConfig !== undefined && !isValidCollisionConfig(raw.collisionConfig)) {
    return false;
  }
  if (raw.customInertiaKgM2 !== undefined && !isNonNegativeTuple3(raw.customInertiaKgM2)) {
    return false;
  }
  if (raw.importedEngineering !== undefined) {
    if (!isPlainObject(raw.importedEngineering)) return false;
    if (
      raw.importedEngineering.massKg !== undefined &&
      !isNonNegativeFinite(raw.importedEngineering.massKg)
    ) {
      return false;
    }
    if (
      raw.importedEngineering.centerOfMassLocal !== undefined &&
      !isFiniteTuple3(raw.importedEngineering.centerOfMassLocal)
    ) {
      return false;
    }
    if (
      raw.importedEngineering.inertiaKgM2 !== undefined &&
      !isNonNegativeTuple3(raw.importedEngineering.inertiaKgM2)
    ) {
      return false;
    }
  }
  return true;
}

function validateConnectionRecord(raw: unknown): RobotConnection | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (raw.type !== "Motor-Wheel" && raw.type !== "Mechanical") return null;
  const rawParentId =
    typeof raw.parentId === "string" && raw.parentId.length > 0
      ? raw.parentId
      : typeof raw.sourceId === "string" && raw.sourceId.length > 0
        ? raw.sourceId
        : null;
  const rawChildId =
    typeof raw.childId === "string" && raw.childId.length > 0
      ? raw.childId
      : typeof raw.targetId === "string" && raw.targetId.length > 0
        ? raw.targetId
        : null;
  if (!rawParentId || !rawChildId) return null;

  if (raw.relativePosition !== undefined && !isFiniteTuple3(raw.relativePosition)) {
    return null;
  }
  if (raw.relativeRotation !== undefined && !isFiniteTuple3(raw.relativeRotation)) {
    return null;
  }
  if (raw.wheelOffset !== undefined && !isFiniteTuple3(raw.wheelOffset)) {
    return null;
  }

  return {
    ...(structuredClone(raw) as unknown as RobotConnection),
    id: raw.id,
    sourceId: rawParentId,
    targetId: rawChildId,
    parentId: rawParentId,
    childId: rawChildId,
    type: raw.type,
    parentMountPointId:
      typeof raw.parentMountPointId === "string"
        ? raw.parentMountPointId
        : "generic-mount",
    childMountPointId:
      typeof raw.childMountPointId === "string"
        ? raw.childMountPointId
        : "generic-mount",
    relativePosition: raw.relativePosition ? [...raw.relativePosition] : [0, 0, 0],
    relativeRotation: raw.relativeRotation ? [...raw.relativeRotation] : [0, 0, 0],
  };
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

  const migration = migrateProjectPayload(stripUnsafeObjectKeys(parsed));
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
  const seenPartIds = new Set<string>();
  for (const candidate of rawBuild.parts) {
    if (validatePartRecord(candidate)) {
      if (seenPartIds.has(candidate.id)) {
        warnings.push(`Skipped duplicate component ID '${candidate.id}' during project load.`);
        continue;
      }
      seenPartIds.add(candidate.id);
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

  const rawConnectionsList = Array.isArray(rawBuild.connections)
    ? rawBuild.connections
    : [];
  if (!Array.isArray(rawBuild.connections)) {
    warnings.push("Missing 'build.connections'; defaulted to empty connection list.");
  }
  const validatedConnections: RobotConnection[] = [];
  for (const rawConn of rawConnectionsList) {
    const normalized = validateConnectionRecord(rawConn);
    if (normalized) {
      validatedConnections.push(normalized);
    } else {
      warnings.push("Skipped one or more malformed mechanical connection entries.");
    }
  }

  const rawFoundation = validateFoundationPayload(rawBuild.foundation, warnings);

  const rawElectrical = isPlainObject(v2.electrical) ? v2.electrical : {};
  const rawElectricalConnections: ElectricalConnection[] = Array.isArray(
    rawElectrical.connections
  )
    ? structuredClone(
        rawElectrical.connections.filter(
          (c): c is ElectricalConnection =>
            isPlainObject(c) &&
            typeof c.id === "string" &&
            c.id.length > 0 &&
            typeof c.sourcePartId === "string" &&
            c.sourcePartId.length > 0 &&
            typeof c.targetPartId === "string" &&
            c.targetPartId.length > 0 &&
            typeof c.sourceInterfaceId === "string" &&
            c.sourceInterfaceId.length > 0 &&
            typeof c.targetInterfaceId === "string" &&
            c.targetInterfaceId.length > 0 &&
            (c.connectionType === undefined ||
              (typeof c.connectionType === "string" &&
                VALID_ELECTRICAL_KINDS.has(
                  c.connectionType as ElectricalConnectionKind
                )))
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
      item.assetId.length === 0 ||
      typeof item.centeredPositionsBase64 !== "string" ||
      typeof item.normalsBase64 !== "string" ||
      !isPlainObject(item.inspection) ||
      typeof item.inspection.fileName !== "string" ||
      typeof item.inspection.triangleCount !== "number" ||
      !Number.isInteger(item.inspection.triangleCount) ||
      item.inspection.triangleCount <= 0 ||
      !isPositiveTuple3(item.inspection.rawDimensions) ||
      !isFiniteTuple3(item.inspection.rawBoundsMin) ||
      !isFiniteTuple3(item.inspection.rawBoundsMax)
    ) {
      warnings.push("Skipped malformed embedded STL asset entry.");
      continue;
    }
    if (seenDecodedIds.has(item.assetId)) continue;
    try {
      const centeredPositions = decodeFloat32ArrayBase64(item.centeredPositionsBase64);
      const normals = decodeFloat32ArrayBase64(item.normalsBase64);
      if (
        centeredPositions.length === 0 ||
        centeredPositions.length % 9 !== 0 ||
        centeredPositions.length !== normals.length ||
        item.inspection.triangleCount * 9 !== centeredPositions.length
      ) {
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

  // Sanitize assembly graph FIRST so cycles, duplicate parents, and invalid links are eliminated
  // before parent-child transform synchronization traverses the graph.
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

  const sanitized = sanitizeAssemblyGraph({
    parts: validParts,
    connections: validatedConnections,
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
  const syncedParts = syncAssemblyTransforms(
    sanitized.parts,
    sanitized.connections
  );

  if (sanitized.connections.length < validatedConnections.length) {
    warnings.push(
      `Removed ${validatedConnections.length - sanitized.connections.length} invalid or cyclic mechanical connection(s) during graph sanitization.`
    );
  }
  if (sanitized.electricalConnections.length < rawElectricalConnections.length) {
    warnings.push(
      `Removed ${
        rawElectricalConnections.length - sanitized.electricalConnections.length
      } dangling electrical wire(s) whose endpoints or interfaces no longer exist.`
    );
  }

  // Check for referenced STL assets that were not bundled in file or already registered,
  // and retain only referenced decoded assets to prevent stale/unreferenced asset clutter.
  const referencedAssetIds = new Set<string>();
  collectSnapshotMeshAssetIds(syncedParts, sanitized.foundation, referencedAssetIds);
  const referencedDecodedAssets = decodedAssets.filter((a) =>
    referencedAssetIds.has(a.assetId)
  );
  if (referencedDecodedAssets.length < decodedAssets.length) {
    warnings.push(
      `Ignored ${decodedAssets.length - referencedDecodedAssets.length} unreferenced embedded STL asset(s).`
    );
  }
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

  const validSensorIds = new Set(
    resolveRobotSensors({
      parts: syncedParts,
      electricalConnections: sanitized.electricalConnections,
    }).map((s) => s.sensorId)
  );
  const rawProg = isPlainObject(v2.programming) ? v2.programming : {};
  const validatedActiveProgram = validateVisualProgramPayload(
    rawProg.activeProgram,
    validSensorIds
  );
  const activeProgram = validatedActiveProgram ?? createStarterPresets()[0];
  if (rawProg.activeProgram !== undefined && !validatedActiveProgram) {
    warnings.push("Saved visual program failed validation; reverted to starter preset.");
  }

  const savedPrograms = Array.isArray(rawProg.savedPrograms)
    ? rawProg.savedPrograms
        .map((p) => validateVisualProgramPayload(p, validSensorIds))
        .filter((p): p is VisualRobotProgram => p !== null)
    : undefined;
  if (
    Array.isArray(rawProg.savedPrograms) &&
    savedPrograms &&
    savedPrograms.length < rawProg.savedPrograms.length
  ) {
    warnings.push("Skipped one or more invalid saved visual program routines.");
  }

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
      parts: syncedParts,
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
      referencedDecodedAssets.some(
        (d) => isPlainObject(item) && item.assetId === d.assetId
      )
    ),
  };

  return {
    success: true,
    project: normalizedProject,
    decodedAssets: referencedDecodedAssets,
    restoredAssetIds: referencedDecodedAssets.map((a) => a.assetId),
    orphanedAssetIds,
    migratedFromVersion: migration.migratedFromVersion,
    warnings,
    errors,
  };
}

function buffersEqualFloat32(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Registers decoded STL buffers into meshAssetRegistry so the store can retain them,
 * preserving already-retained identical buffers so active cached Three.js geometry isn't
 * prematurely disposed during reload.
 */
export function registerDecodedProjectAssets(
  decodedAssets: readonly DecodedMeshAssetPayload[]
): void {
  for (const asset of decodedAssets) {
    const existing = getMeshAssetRecord(asset.assetId);
    if (
      existing &&
      existing.refCount > 0 &&
      buffersEqualFloat32(existing.centeredPositions, asset.centeredPositions) &&
      buffersEqualFloat32(existing.normals, asset.normals)
    ) {
      continue;
    }
    restoreMeshAssetRecord({
      assetId: asset.assetId,
      centeredPositions: asset.centeredPositions,
      normals: asset.normals,
      inspection: asset.inspection,
    });
  }
}
