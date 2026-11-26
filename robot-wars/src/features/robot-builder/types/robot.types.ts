import type {
  BoxGeometry,
  ComponentGeometry,
  CylinderGeometry,
  ElectricalSpecs,
  MechanicalSpecs,
} from "./dimensions.types";
import type {
  ComponentEngineeringSpec,
  MotorEngineeringSpec,
  ProvenanceMeta,
  StructuralEngineeringSpec,
  WheelEngineeringSpec,
  BatteryEngineeringSpec,
  ControllerEngineeringSpec,
} from "./engineering.types";
import type {
  CustomCollisionConfig,
  FoundationMemberRole,
  FoundationWorkflowMode,
  ImportedEngineeringProperties,
  ImportedFoundationConfig,
  ImportedMeshTransform,
  MountingPatternConfig,
  ProceduralFoundationConfig,
} from "./foundation.types";
import type { ElectricalComponentSpec } from "../../electrical/types/electrical.types";

export * from "./foundation.types";

export type StructuralCatalogueId =
  | "l-bracket"
  | "mounting-bracket"
  | "flat-plate"
  | "crossbar"
  | "structural-rail"
  | "hex-standoff"
  | "spacer"
  | "box-beam"
  | "adjustable-bar"
  | "reinforced-bumper";

export type StructuralCategory =
  | "bracket"
  | "plate"
  | "rail"
  | "crossbar"
  | "spacer"
  | "beam"
  | "bumper";

export type StructuralVisualShape = StructuralCatalogueId;

export type AttachmentInterfaceKind =
  | "foundation-deck"
  | "foundation-rail"
  | "foundation-bumper"
  | "rail-slot"
  | "bracket-face"
  | "plate-mount"
  | "motor-mount"
  | "wheel-hub"
  | "generic-structural"
  | "unknown";

export type AttachmentCompatibilityStatus =
  | "compatible"
  | "compatible-with-warnings"
  | "incompatible"
  | "unknown";

export type AttachmentInterfaceConstraint = {
  maxLengthM?: number;
  maxWidthM?: number;
  minClearanceM?: number;
  maxPayloadKg?: number;
};

export type AttachmentInterface = {
  id: string;
  label: string;
  kind: AttachmentInterfaceKind;
  position: Vector3Data;
  rotation: EulerData;
  compatibleWith: AttachmentInterfaceKind[];
  compatibilityStatus: AttachmentCompatibilityStatus;
  supportedTypes?: ComponentType[];
  dimensionConstraint?: AttachmentInterfaceConstraint;
  clearanceRadiusM?: number;
  provenance?: ProvenanceMeta;
  isCustom?: boolean;
  interfaceCategory?: "point" | "plane" | "pattern" | "motor-mount" | "wheel-mount" | "generic";
  mountingPattern?: MountingPatternConfig;
};

export type RobotPart = {
  id: string;
  name: string;
  type: ComponentType;
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  color: string;
  mass: number;
  parentAttachmentId?: string;
  motorCatalogueId?: MotorCatalogueId;
  mountingZoneId?: string;
  wheelCatalogueId?: WheelCatalogueId;
  wheelDiameter?: number;
  wheelWidth?: number;
  batteryCatalogueId?: BatteryCatalogueId;
  controllerCatalogueId?: ControllerCatalogueId;
  foundationModelId?: FoundationModelId;
  structuralCatalogueId?: StructuralCatalogueId;
  structuralCategory?: StructuralCategory;
  structuralVisualShape?: StructuralVisualShape;
  foundationMemberRole?: FoundationMemberRole;
  foundationMemberEditable?: boolean;
  mountingPatterns?: MountingPatternConfig[];
  customMountingInterfaces?: AttachmentInterface[];
  meshAssetId?: string;
  meshTransform?: ImportedMeshTransform;
  collisionConfig?: CustomCollisionConfig;
  importedEngineering?: ImportedEngineeringProperties;
  customInertiaKgM2?: [number, number, number];
  geometry?: ComponentGeometry;
  massKg?: number;
  electrical?: ElectricalSpecs;
  mechanical?: MechanicalSpecs;
  engineeringSpec?: ComponentEngineeringSpec;
  electricalSpec?: ElectricalComponentSpec;
  electricalCatalogueId?: string;
};

export type Vector3Data = [number, number, number];
export type EulerData = [number, number, number];

export type MountingPoint = {
  id: string;
  type: string;
  position: Vector3Data;
  rotation: EulerData;
  compatibility: string[];
};

export type RobotConnection = {
  id: string;
  sourceId: string;
  targetId: string;
  type: "Motor-Wheel" | "Mechanical";
  parentId: string;
  childId: string;
  parentMountPointId: string;
  childMountPointId: string;
  relativePosition: Vector3Data;
  relativeRotation: EulerData;
  wheelOffset?: [number, number, number];
};

export type TransformMode = "select" | "translate" | "rotate" | "scale";
export type ComponentType =
  | "Armor Plate"
  | "Structural Block"
  | "Front Bumper"
  | "Wheel"
  | "Motor"
  | "Battery"
  | "Controller";

export type FoundationModelId =
  | "compact-square"
  | "standard-rectangular"
  | "long-frame";

export type FoundationConfig = {
  modelId: FoundationModelId;
  length: number;
  width: number;
  height: number;
  includeTopPlate: boolean;
  includeFrontCover: boolean;
  confirmed: boolean;
  mode?: FoundationWorkflowMode;
  procedural?: ProceduralFoundationConfig;
  imported?: ImportedFoundationConfig;
};

export type BuildStage =
  | "foundation"
  | "structure"
  | "battery"
  | "controller"
  | "motors"
  | "wheels"
  | "drivetrain"
  | "completed";

export type StructuralDefinition = {
  id: StructuralCatalogueId;
  name: string;
  category: StructuralCategory;
  description: string;
  componentType: "Armor Plate" | "Structural Block" | "Front Bumper";
  visualShape: StructuralVisualShape;
  dimensions: {
    length: number;
    height: number;
    width: number;
  };
  minDimensions: {
    length: number;
    height: number;
    width: number;
  };
  maxDimensions: {
    length: number;
    height: number;
    width: number;
  };
  color: string;
  massKg: number;
  geometry: BoxGeometry | CylinderGeometry;
  engineeringSpec: StructuralEngineeringSpec;
};

export type DrivetrainType = "differential-2" | "differential-4";
export type DrivetrainSide = "left" | "right";

export type DrivetrainAssignment = {
  motorId: string;
  wheelId: string;
};

export type DrivetrainConfiguration = {
  type: DrivetrainType;
  left: Array<DrivetrainAssignment | null>;
  right: Array<DrivetrainAssignment | null>;
  mappingCustomized: boolean;
};

export type MotorCatalogueId =
  | "small-dc"
  | "standard-dc"
  | "high-torque-dc";

export type BatteryCatalogueId =
  | "compact-lipo"
  | "standard-lipo"
  | "heavy-duty-lipo";

export type BatteryDefinition = {
  id: BatteryCatalogueId;
  name: string;
  chemistry: "LiPo";
  voltage: number;
  capacityMah: number;
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  weight: number;
  color: string;
  geometry: BoxGeometry;
  massKg: number;
  electrical: ElectricalSpecs;
  engineeringSpec?: BatteryEngineeringSpec;
};

export type ControllerCatalogueId =
  | "arduino-uno"
  | "esp32-devkit"
  | "stm32-nucleo";

export type ControllerDefinition = {
  id: ControllerCatalogueId;
  name: string;
  controllerType:
    | "Microcontroller board"
    | "Wireless development board"
    | "Development board";
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  weight: number;
  color: string;
  processor: string;
  clockMHz: number;
  operatingVoltage: string;
  geometry: BoxGeometry;
  massKg: number;
  electrical: ElectricalSpecs;
  engineeringSpec?: ControllerEngineeringSpec;
};

export type MotorDefinition = {
  id: MotorCatalogueId;
  name: string;
  description: string;
  dimensions: [number, number, number];
  weight: number;
  rpm: number;
  torque: number;
  mountingFootprint: [number, number];
  color: string;
  geometry: BoxGeometry;
  massKg: number;
  mechanical: MechanicalSpecs;
  engineeringSpec?: MotorEngineeringSpec;
};

export type MotorMountZone = {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  accepts: MotorCatalogueId[];
};

export type WheelCatalogueId =
  | "standard-rubber"
  | "heavy-duty"
  | "grip"
  | "small-omni";

export type WheelDefinition = {
  id: WheelCatalogueId;
  name: string;
  description: string;
  diameter: number;
  width: number;
  weight: number;
  category: "Rubber" | "Heavy-duty" | "Grip" | "Omni";
  color: string;
  compatibleMotorIds: MotorCatalogueId[];
  geometry: CylinderGeometry;
  massKg: number;
  engineeringSpec?: WheelEngineeringSpec;
};

export type WheelDimensionDraft = {
  diameterCm: number;
  widthCm: number;
};

export * from "./dimensions.types";
export * from "./engineering.types";
