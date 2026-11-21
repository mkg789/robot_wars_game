import type { MountingPoint } from "../types/robot.types";

export const motorMountingPoints = (motorSize: [number, number, number]) => ({
  shaft: {
    id: "motor-shaft",
    type: "axle",
    position: [motorSize[0] * 0.775, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    compatibility: ["wheel-hub"],
  } satisfies MountingPoint,
});

export const wheelMountingPoints = (wheelSize: [number, number, number]) => ({
  hub: {
    id: "wheel-hub",
    type: "hub",
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    compatibility: ["axle"],
  } satisfies MountingPoint,
  axle: {
    id: "wheel-axle",
    type: "axle",
    position: [0, 0, wheelSize[1] * 0.5] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    compatibility: ["motor-shaft"],
  } satisfies MountingPoint,
});
