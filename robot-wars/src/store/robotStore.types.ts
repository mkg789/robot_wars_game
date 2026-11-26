import type { StoreApi } from "zustand";
import type {
  RobotPart,
  TransformMode,
  ComponentType,
  ComponentGeometry,
  RobotConnection,
  FoundationConfig,
  FoundationModelId,
  BuildStage,
  AttachmentInterface,
  CustomCollisionConfig,
  ImportedEngineeringProperties,
  ImportedMeshTransform,
  MeshAssetInspection,
  MountingPatternConfig,
  ProceduralFoundationArchitectureId,
  ProceduralFoundationConfig,
  MotorCatalogueId,
  WheelCatalogueId,
  WheelDimensionDraft,
  BatteryCatalogueId,
  ControllerCatalogueId,
  DrivetrainAssignment,
  DrivetrainConfiguration,
  DrivetrainSide,
  DrivetrainType,
  StructuralCatalogueId,
} from "../features/robot-builder/types/robot.types";
import type {
  ElectricalComponentSpec,
  ElectricalConnection,
  ElectricalConnectorSpec,
  ElectricalDiagnostic,
  ElectricalValidationReport,
} from "../features/electrical/types/electrical.types";
import type { VisualRobotProgram } from "../features/programming/types/programWorkspace.types";
import type { ProjectLoadResult } from "../features/persistence/types/project.types";

export type AssemblyHistorySnapshot = {
  parts: RobotPart[];
  connections: RobotConnection[];
  electricalConnections: ElectricalConnection[];
  foundation: FoundationConfig | null;
  foundationId: string | null;
  drivetrain: DrivetrainConfiguration;
  hiddenPartIds: string[];
  stage: BuildStage;
};

export const MAX_ASSEMBLY_HISTORY = 40;

export type RobotStore = {
  projectName: string;
  projectCreatedAtIso: string;
  selectedArenaId: string;
  visualProgram: VisualRobotProgram;
  projectRevision: number;
  lastProjectLoadWarnings: string[];
  setProjectName: (name: string) => void;
  setSelectedArenaId: (arenaId: string) => void;
  setVisualProgram: (program: VisualRobotProgram) => void;
  clearProjectLoadWarnings: () => void;
  loadProjectState: (loaded: ProjectLoadResult) => boolean;

  parts: RobotPart[];
  connections: RobotConnection[];
  electricalConnections: ElectricalConnection[];
  hiddenPartIds: string[];
  selectedId: string | null;
  transformMode: TransformMode;
  historyPast: AssemblyHistorySnapshot[];
  historyFuture: AssemblyHistorySnapshot[];
  activeTransformPreview: {
    readonly partId: string;
    readonly baselineSnapshot: AssemblyHistorySnapshot;
  } | null;

  setSelectedId: (id: string | null) => void;
  togglePartVisibility: (id: string) => void;
  setTransformMode: (mode: TransformMode) => void;
  deleteSelected: () => void;
  deletePartById: (id: string) => void;
  undo: () => boolean;
  redo: () => boolean;

  updatePartTransform: (
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    size?: [number, number, number]
  ) => void;
  previewPartTransform: (
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    size?: [number, number, number]
  ) => void;

  updatePartPosition: (
    id: string,
    position: [number, number, number]
  ) => void;

  updatePartSize: (
    id: string,
    size: [number, number, number]
  ) => void;

  updatePartRotation: (
    id: string,
    rotation: [number, number, number]
  ) => void;

  updatePartGeometry: (
    id: string,
    geometry: ComponentGeometry
  ) => void;

  updatePartMass: (
    id: string,
    massKg: number
  ) => void;

  addPart: (type: ComponentType) => void;

  connectParts: (sourceId: string, targetId: string) => void;
  disconnectParts: (connectionId: string) => void;
  mountWheelToMotor: (motorId: string, wheelId: string) => void;
  unmountPart: (childId: string) => void;
  foundation: FoundationConfig | null;
  foundationId: string | null;
  startNewBuild: () => void;
  selectFoundationModel: (modelId: FoundationModelId) => void;
  updateFoundationDimensions: (
    dimensions: Partial<Pick<FoundationConfig, "length" | "width" | "height">>
  ) => void;
  setFoundationOptions: (
    options: Partial<
      Pick<FoundationConfig, "includeTopPlate" | "includeFrontCover">
    >
  ) => void;
  configureProceduralFoundation: (
    patch: Partial<ProceduralFoundationConfig> & {
      architecture?: ProceduralFoundationArchitectureId;
    }
  ) => void;
  resetProceduralFoundation: (
    architecture?: ProceduralFoundationArchitectureId
  ) => void;
  importFoundationStl: (params: {
    assetId: string;
    fileName: string;
    inspection: MeshAssetInspection;
    transform: ImportedMeshTransform;
    engineering: ImportedEngineeringProperties;
    collision: CustomCollisionConfig;
    name?: string;
  }) => void;
  importStructuralStl: (params: {
    assetId: string;
    fileName: string;
    inspection: MeshAssetInspection;
    transform: ImportedMeshTransform;
    engineering: ImportedEngineeringProperties;
    collision: CustomCollisionConfig;
    name?: string;
    parentId?: string;
    parentInterfaceId?: string;
  }) => string | null;
  updateImportedPartConfiguration: (
    partId: string,
    patch: {
      transform?: Partial<ImportedMeshTransform>;
      engineering?: Partial<ImportedEngineeringProperties>;
      collision?: CustomCollisionConfig;
    }
  ) => void;
  addCustomMountingInterface: (
    partId: string,
    iface: AttachmentInterface
  ) => void;
  updateCustomMountingInterface: (
    partId: string,
    ifaceId: string,
    patch: Partial<AttachmentInterface>
  ) => void;
  removeCustomMountingInterface: (partId: string, ifaceId: string) => void;
  updatePartMountingPattern: (
    partId: string,
    pattern: MountingPatternConfig
  ) => void;
  confirmFoundation: () => void;
  stage: BuildStage;
  drivetrain: DrivetrainConfiguration;
  setDrivetrainType: (
    type: DrivetrainType,
    confirmDiscard?: boolean
  ) => boolean;
  setDrivetrainAssignment: (
    side: DrivetrainSide,
    index: number,
    assignment: DrivetrainAssignment | null
  ) => void;
  applySuggestedDrivetrainMapping: (confirmCustomized?: boolean) => boolean;
  selectedMotorCatalogueId: MotorCatalogueId | null;
  selectedMountZoneId: string | null;
  selectedWheelCatalogueId: WheelCatalogueId | null;
  selectedWheelMotorId: string | null;
  selectedWheelDiameterCm: number;
  selectedWheelWidthCm: number;
  selectedBatteryCatalogueId: BatteryCatalogueId | null;
  selectedControllerCatalogueId: ControllerCatalogueId | null;
  selectedStructuralCatalogueId: StructuralCatalogueId | null;
  lastReplacementWarning: string | null;
  clearReplacementWarning: () => void;
  setStage: (stage: BuildStage) => void;
  selectStructuralCatalogueItem: (structuralId: StructuralCatalogueId) => void;
  addStructuralPart: (
    structuralId: StructuralCatalogueId,
    options?: {
      parentId?: string;
      parentInterfaceId?: string;
      childInterfaceId?: string;
    }
  ) => string | null;
  replaceStructuralPart: (
    partId: string,
    structuralId: StructuralCatalogueId
  ) => void;
  duplicatePart: (partId: string) => string | null;
  attachPart: (
    childId: string,
    parentId: string,
    parentInterfaceId?: string,
    childInterfaceId?: string
  ) => boolean;
  detachPart: (childId: string) => void;
  selectBatteryCatalogueItem: (batteryId: BatteryCatalogueId) => void;
  installBattery: (batteryId: BatteryCatalogueId) => void;
  removeBattery: () => void;
  selectControllerCatalogueItem: (
    controllerId: ControllerCatalogueId
  ) => void;
  installController: (controllerId: ControllerCatalogueId) => void;
  removeController: () => void;
  selectMotorCatalogueItem: (motorId: MotorCatalogueId) => void;
  selectMountZone: (zoneId: string) => void;
  placeMotor: () => void;
  mountMotorToParent: (
    parentId: string,
    parentInterfaceId?: string,
    motorCatalogueId?: MotorCatalogueId
  ) => string | null;
  replaceMotor: (zoneId: string) => void;
  removeMotor: (zoneId: string) => void;
  rotateMotor: (zoneId: string, rotationY?: number) => void;
  selectWheelCatalogueItem: (wheelId: WheelCatalogueId) => void;
  updateSelectedWheelDimensions: (
    dimensions: Partial<WheelDimensionDraft>
  ) => void;
  selectWheelMotor: (motorId: string) => void;
  assignWheel: (motorId: string) => void;
  removeWheel: (motorId: string) => void;
  finishBuild: () => void;
  assignPartElectricalSpec: (
    partId: string,
    spec: ElectricalComponentSpec
  ) => void;
  addElectricalConnection: (
    conn: Omit<ElectricalConnection, "id"> & { id?: string }
  ) => string | null;
  updateElectricalConnection: (
    connectionId: string,
    patch: Partial<ElectricalConnection>
  ) => void;
  removeElectricalConnection: (connectionId: string) => void;
  assignConnectorToInterface: (
    partId: string,
    interfaceId: string,
    connector: ElectricalConnectorSpec
  ) => void;
  assignPinToElectricalConnection: (
    connectionId: string,
    endpoint: "source" | "target",
    pinId: string | undefined
  ) => void;
  updatePartElectricalProperties: (
    partId: string,
    patch: Partial<ElectricalComponentSpec>
  ) => void;
  setElectricalSwitchState: (partId: string, switchClosed: boolean) => void;
  addElectricalComponent: (input: {
    id?: string;
    name: string;
    partType?: ComponentType;
    electricalSpec: ElectricalComponentSpec;
    position?: [number, number, number];
    size?: [number, number, number];
    color?: string;
    massKg?: number;
  }) => string;
  removeElectricalComponent: (partId: string) => void;
  validateElectricalState: () => ElectricalValidationReport;
  selectedElectricalConnectionId: string | null;
  selectedElectricalPinId: string | null;
  setSelectedElectricalConnection: (connectionId: string | null) => void;
  setSelectedElectricalPin: (partId: string | null, pinId: string | null) => void;
  focusElectricalDiagnostic: (
    diagnostic: Pick<ElectricalDiagnostic, "partId" | "connectionId" | "pinId">
  ) => void;
  installElectricalCatalogueItem: (
    catalogueId: string,
    options?: {
      id?: string;
      name?: string;
      parentId?: string;
      parentInterfaceId?: string;
      position?: [number, number, number];
    }
  ) => string | null;
  replaceElectricalComponent: (partId: string, catalogueId: string) => boolean;
};

export type StoreRawSet = StoreApi<RobotStore>["setState"];
export type StoreGet = () => RobotStore;
export type StoreSet = (
  partialOrUpdater:
    | Partial<RobotStore>
    | ((state: RobotStore) => Partial<RobotStore> | RobotStore)
) => void;

export type FoundationSliceKeys =
  | "startNewBuild"
  | "selectFoundationModel"
  | "updateFoundationDimensions"
  | "setFoundationOptions"
  | "configureProceduralFoundation"
  | "resetProceduralFoundation"
  | "importFoundationStl"
  | "importStructuralStl"
  | "updateImportedPartConfiguration"
  | "addCustomMountingInterface"
  | "updateCustomMountingInterface"
  | "removeCustomMountingInterface"
  | "updatePartMountingPattern"
  | "confirmFoundation";

export type PartsSliceKeys =
  | "deletePartById"
  | "deleteSelected"
  | "updatePartTransform"
  | "previewPartTransform"
  | "updatePartPosition"
  | "updatePartSize"
  | "updatePartRotation"
  | "updatePartGeometry"
  | "updatePartMass"
  | "addPart"
  | "connectParts"
  | "disconnectParts"
  | "mountWheelToMotor"
  | "unmountPart"
  | "selectStructuralCatalogueItem"
  | "addStructuralPart"
  | "replaceStructuralPart"
  | "duplicatePart"
  | "attachPart"
  | "detachPart";

export type DrivetrainSliceKeys =
  | "setDrivetrainType"
  | "setDrivetrainAssignment"
  | "applySuggestedDrivetrainMapping"
  | "selectMotorCatalogueItem"
  | "selectMountZone"
  | "placeMotor"
  | "mountMotorToParent"
  | "replaceMotor"
  | "removeMotor"
  | "rotateMotor"
  | "selectWheelCatalogueItem"
  | "updateSelectedWheelDimensions"
  | "selectWheelMotor"
  | "assignWheel"
  | "removeWheel"
  | "selectBatteryCatalogueItem"
  | "installBattery"
  | "removeBattery"
  | "selectControllerCatalogueItem"
  | "installController"
  | "removeController"
  | "finishBuild";

export type ElectricalSliceKeys =
  | "assignPartElectricalSpec"
  | "addElectricalConnection"
  | "updateElectricalConnection"
  | "removeElectricalConnection"
  | "assignConnectorToInterface"
  | "assignPinToElectricalConnection"
  | "updatePartElectricalProperties"
  | "setElectricalSwitchState"
  | "addElectricalComponent"
  | "removeElectricalComponent"
  | "validateElectricalState"
  | "installElectricalCatalogueItem"
  | "replaceElectricalComponent";
