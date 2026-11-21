import type { RobotPart } from "../types/robot.types";

export const initialParts: RobotPart[] = [
  {
    id: "chassis",
    name: "Main Chassis",
    type: "Structural Block",
    position: [0, 0.65, 0],
    rotation: [0, 0, 0],
    size: [2, 0.35, 1.4],
    color: "#313b49",
    mass: 1.5,
  },
  {
    id: "upper-plate",
    name: "Upper Plate",
    type: "Armor Plate",
    position: [0, 0.88, 0],
    rotation: [0, 0, 0],
    size: [1.65, 0.12, 1.1],
    color: "#586574",
    mass: 0.4,
  },
  {
    id: "front-bumper",
    name: "Front Bumper",
    type: "Front Bumper",
    position: [0, 0.55, 0.76],
    rotation: [0, 0, 0],
    size: [1.8, 0.22, 0.12],
    color: "#f59e0b",
    mass: 0.3,
  },
  {
    id: "rear-bumper",
    name: "Rear Bumper",
    type: "Front Bumper",
    position: [0, 0.55, -0.76],
    rotation: [0, 0, 0],
    size: [1.8, 0.22, 0.12],
    color: "#64748b",
    mass: 0.3,
  },
];