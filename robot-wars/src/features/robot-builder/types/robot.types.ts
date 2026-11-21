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
  | "Motor";

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
};

export type BuildStage = "foundation" | "motors" | "wheels" | "completed";

export type MotorCatalogueId =
  | "small-dc"
  | "standard-dc"
  | "high-torque-dc";

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
};