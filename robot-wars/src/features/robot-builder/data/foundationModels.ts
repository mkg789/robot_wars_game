import type { FoundationModelId } from "../types/robot.types";

export type FoundationModel = {
  id: FoundationModelId;
  name: string;
  description: string;
  length: number;
  width: number;
  height: number;
  icon: string;
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
  },
  {
    id: "standard-rectangular",
    name: "Standard Rectangle",
    description: "Versatile four-wheel base with ample mounting room.",
    length: 2,
    width: 1.5,
    height: 0.35,
    icon: "▬",
  },
  {
    id: "long-frame",
    name: "Long Frame",
    description: "Extended chassis for larger assemblies and payloads.",
    length: 2.6,
    width: 1.25,
    height: 0.32,
    icon: "▰",
  },
];

