import type { BoxGeometry } from "../types/dimensions.types";
import type { FoundationModelId } from "../types/robot.types";
import type { StructuralEngineeringSpec } from "../types/engineering.types";

export type FoundationModel = {
  id: FoundationModelId;
  name: string;
  description: string;
  length: number;
  width: number;
  height: number;
  icon: string;
  geometry: BoxGeometry;
  engineeringSpec?: StructuralEngineeringSpec;
};

export const foundationModels: FoundationModel[] = [
  {
    id: "compact-square",
    name: "Compact Square",
    description: "Balanced small chassis for lightweight robots.",
    length: 1.6,
    width: 1.4,
    height: 0.28,
    icon: "▣",
    geometry: {
      shape: "box",
      length: 1.6,
      height: 0.28,
      width: 1.4,
    },
    engineeringSpec: {
      category: "structural",
      role: "chassis-frame",
      fieldProvenance: {
        role: {
          method: "estimated",
          basis: "Designated structural role as robot foundation chassis frame",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:foundation:compact-square",
        notes:
          "Generic game preset chassis frame (1.6m × 1.4m × 0.28m). Not verified against an official manufacturer specification; material alloy, wall thickness, and structural load capacity are unverified and left undefined.",
      },
    },
  },
  {
    id: "standard-rectangular",
    name: "Standard Rectangle",
    description: "Versatile four-wheel base with ample mounting room.",
    length: 2,
    width: 1.5,
    height: 0.35,
    icon: "▬",
    geometry: {
      shape: "box",
      length: 2,
      height: 0.35,
      width: 1.5,
    },
    engineeringSpec: {
      category: "structural",
      role: "chassis-frame",
      fieldProvenance: {
        role: {
          method: "estimated",
          basis: "Designated structural role as robot foundation chassis frame",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:foundation:standard-rectangular",
        notes:
          "Generic game preset chassis frame (2.0m × 1.5m × 0.35m). Not verified against an official manufacturer specification; material alloy, wall thickness, and structural load capacity are unverified and left undefined.",
      },
    },
  },
  {
    id: "long-frame",
    name: "Long Frame",
    description: "Extended chassis for larger assemblies and payloads.",
    length: 2.6,
    width: 1.25,
    height: 0.32,
    icon: "▰",
    geometry: {
      shape: "box",
      length: 2.6,
      height: 0.32,
      width: 1.25,
    },
    engineeringSpec: {
      category: "structural",
      role: "chassis-frame",
      fieldProvenance: {
        role: {
          method: "estimated",
          basis: "Designated structural role as robot foundation chassis frame",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:foundation:long-frame",
        notes:
          "Generic game preset chassis frame (2.6m × 1.25m × 0.32m). Not verified against an official manufacturer specification; material alloy, wall thickness, and structural load capacity are unverified and left undefined.",
      },
    },
  },
];
