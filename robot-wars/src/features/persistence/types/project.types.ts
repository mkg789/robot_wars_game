import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type { VisualRobotProgram } from "../../programming/types/programWorkspace.types";
import type {
  BuildStage,
  DrivetrainConfiguration,
  FoundationConfig,
  MeshAssetInspection,
  RobotConnection,
  RobotPart,
} from "../../robot-builder/types/robot.types";

export const PROJECT_FORMAT_ID = "robot-wars-project" as const;
export const CURRENT_PROJECT_SCHEMA_VERSION = 2 as const;

export interface SerializedMeshAsset {
  readonly assetId: string;
  readonly fileName: string;
  readonly inspection: MeshAssetInspection;
  readonly centeredPositionsBase64: string;
  readonly normalsBase64: string;
}

export interface ProjectSimulationSettings {
  readonly selectedArenaId: string;
}

export interface ProjectProgrammingState {
  readonly activeProgram: VisualRobotProgram;
  readonly savedPrograms?: readonly VisualRobotProgram[];
}

export interface RobotWarsProject {
  readonly format: typeof PROJECT_FORMAT_ID;
  readonly schemaVersion: typeof CURRENT_PROJECT_SCHEMA_VERSION;
  readonly metadata: {
    readonly name: string;
    readonly createdAtIso: string;
    readonly updatedAtIso: string;
    readonly appName: "Robot Wars";
  };
  readonly build: {
    readonly stage: BuildStage;
    readonly foundationId: string | null;
    readonly foundation: FoundationConfig | null;
    readonly parts: RobotPart[];
    readonly connections: RobotConnection[];
    readonly drivetrain: DrivetrainConfiguration;
    readonly hiddenPartIds: string[];
    readonly selectedId: string | null;
  };
  readonly electrical: {
    readonly connections: ElectricalConnection[];
  };
  readonly simulation: ProjectSimulationSettings;
  readonly programming: ProjectProgrammingState;
  readonly assets: readonly SerializedMeshAsset[];
}

/**
 * Legacy Schema v1 structure supported for forward migration into v2.
 */
export interface LegacyRobotWarsProjectV1 {
  readonly format?: string;
  readonly schemaVersion: 1;
  readonly name?: string;
  readonly createdAtIso?: string;
  readonly updatedAtIso?: string;
  readonly stage?: BuildStage;
  readonly foundationId?: string | null;
  readonly foundation?: FoundationConfig | null;
  readonly parts?: RobotPart[];
  readonly connections?: RobotConnection[];
  readonly electricalConnections?: ElectricalConnection[];
  readonly drivetrain?: DrivetrainConfiguration;
  readonly hiddenPartIds?: string[];
  readonly selectedId?: string | null;
  readonly selectedArenaId?: string;
  readonly visualProgram?: VisualRobotProgram;
  readonly assets?: readonly SerializedMeshAsset[];
}

export interface DecodedMeshAssetPayload {
  readonly assetId: string;
  readonly centeredPositions: Float32Array;
  readonly normals: Float32Array;
  readonly inspection: MeshAssetInspection;
}

export interface ProjectSerializeInput {
  readonly projectName: string;
  readonly createdAtIso?: string;
  readonly stage: BuildStage;
  readonly foundationId: string | null;
  readonly foundation: FoundationConfig | null;
  readonly parts: readonly RobotPart[];
  readonly connections: readonly RobotConnection[];
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly drivetrain: DrivetrainConfiguration;
  readonly hiddenPartIds: readonly string[];
  readonly selectedId: string | null;
  readonly selectedArenaId: string;
  readonly visualProgram: VisualRobotProgram;
  readonly savedPrograms?: readonly VisualRobotProgram[];
}

export interface ProjectLoadResult {
  readonly success: boolean;
  readonly project: RobotWarsProject | null;
  readonly decodedAssets: readonly DecodedMeshAssetPayload[];
  readonly restoredAssetIds: readonly string[];
  readonly orphanedAssetIds: readonly string[];
  readonly migratedFromVersion?: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}
