import type { ProvenanceMeta } from "./engineering.types";

export type FoundationWorkflowMode = "procedural" | "imported";

export type ProceduralFoundationArchitectureId =
  | "flat-plate"
  | "perimeter-frame"
  | "t-slot-frame"
  | "patterned-frame"
  | "sheet-metal-tray"
  | "hybrid";

export type RailProfileKind =
  | "square-tube"
  | "t-slot"
  | "c-channel"
  | "flat-bar";

export type CutoutStyle = "none" | "weight-relief" | "center-bay";

export type FoundationMountingPatternType = "grid" | "linear" | "t-slot" | "custom";

export type MountingPatternOrientation = "top" | "bottom" | "left" | "right" | "front" | "rear";

export interface MountingPitchPreset {
  readonly id: string;
  readonly label: string;
  readonly pitchM: number;
  readonly note: string;
}

export interface MountingPatternConfig {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly type: FoundationMountingPatternType;
  readonly origin: readonly [number, number, number];
  readonly orientation: MountingPatternOrientation;
  /** Spacing along primary longitudinal axis (+X or local U) in meters */
  readonly spacingXM: number;
  /** Spacing along secondary lateral axis (+Z or local V) in meters */
  readonly spacingZM: number;
  readonly rows?: number;
  readonly columns?: number;
  /** Usable pattern boundary in meters around origin */
  readonly boundsLengthM: number;
  readonly boundsWidthM: number;
  readonly holeDiameterM: number;
  readonly customPoints?: ReadonlyArray<readonly [number, number]>;
  readonly provenance?: ProvenanceMeta;
}

export interface SheetMetalFlangeConfig {
  readonly front: boolean;
  readonly rear: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly heightM: number;
  readonly thicknessM: number;
}

export interface ProceduralFoundationConfig {
  readonly architecture: ProceduralFoundationArchitectureId;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  /** Base plate / tray thickness in meters */
  readonly thickness: number;
  readonly railProfile: RailProfileKind;
  readonly railWidth: number;
  readonly railHeight: number;
  readonly includeFrontRail: boolean;
  readonly includeRearRail: boolean;
  readonly includeLeftRail: boolean;
  readonly includeRightRail: boolean;
  readonly crossmemberCount: number;
  readonly crossmemberWidth: number;
  readonly crossmemberHeight: number;
  readonly flanges: SheetMetalFlangeConfig;
  readonly cutoutStyle: CutoutStyle;
  readonly includeCornerBrackets: boolean;
  readonly includeJoiningPlates: boolean;
  readonly includeReinforcementRibs: boolean;
  readonly mountingPattern: MountingPatternConfig;
}

export type StlLengthUnit = "mm" | "cm" | "m" | "in";

export type ImportedMaterialId =
  | "aluminum-6061"
  | "steel-mild"
  | "abs-plastic"
  | "pla-plastic"
  | "carbon-composite"
  | "custom"
  | "unknown";

export type ImportedMassMode = "user" | "estimated-density" | "unknown";
export type ImportedPropertyMode = "user" | "calculated" | "unknown";

export type CustomCollisionMode =
  | "bounding-box"
  | "single-box"
  | "multi-box"
  | "convex-approx";

export interface CustomCollisionBox {
  readonly id: string;
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}

export interface CustomCollisionConfig {
  readonly mode: CustomCollisionMode;
  readonly boxes: readonly CustomCollisionBox[];
  readonly envelopeSize: readonly [number, number, number];
  readonly envelopeCenter: readonly [number, number, number];
  readonly planarFootprint: {
    readonly lengthM: number;
    readonly widthM: number;
  };
  readonly isEstimated: boolean;
  readonly notes?: string;
}

export interface MeshAssetInspection {
  readonly fileName: string;
  readonly format: "binary" | "ascii";
  readonly triangleCount: number;
  readonly vertexCount: number;
  readonly degenerateTriangleCount: number;
  readonly openEdgeCount: number;
  readonly nonManifoldEdgeCount: number;
  readonly isClosedManifold: boolean;
  readonly isValidGeometry: boolean;
  readonly rawBoundsMin: readonly [number, number, number];
  readonly rawBoundsMax: readonly [number, number, number];
  readonly rawDimensions: readonly [number, number, number];
  readonly rawCentroid: readonly [number, number, number];
  /** Signed volume in raw STL coordinate cubed units when closed & consistent */
  readonly rawSignedVolume: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface ImportedMeshTransform {
  readonly unit: StlLengthUnit;
  readonly unitConfirmed: boolean;
  readonly scaleMode: "uniform" | "non-uniform";
  readonly uniformScale: number;
  readonly nonUniformScale: readonly [number, number, number];
  /** Rotation offset in Euler XYZ radians to map CAD axes into +X front, +Y up, +Z left */
  readonly orientationRotation: readonly [number, number, number];
  /** Translation offset applied in meters */
  readonly positionOffset: readonly [number, number, number];
}

export interface ImportedEngineeringProperties {
  readonly materialId: ImportedMaterialId;
  readonly materialName: string;
  readonly materialDensityKgM3?: number;
  readonly massMode: ImportedMassMode;
  readonly massKg?: number;
  readonly centerOfMassMode: ImportedPropertyMode;
  readonly centerOfMassLocal?: readonly [number, number, number];
  readonly inertiaMode: ImportedPropertyMode;
  readonly inertiaKgM2?: readonly [number, number, number];
  readonly provenance: ProvenanceMeta;
}

export interface ImportedFoundationConfig {
  readonly assetId: string;
  readonly fileName: string;
  readonly inspection: MeshAssetInspection;
  readonly transform: ImportedMeshTransform;
  readonly engineering: ImportedEngineeringProperties;
  readonly collision: CustomCollisionConfig;
}

export type FoundationMemberRole =
  | "rail"
  | "crossmember"
  | "plate"
  | "flange"
  | "bracket"
  | "rib"
  | "custom-mesh";
