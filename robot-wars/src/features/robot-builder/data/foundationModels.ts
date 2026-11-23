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
  },
];
