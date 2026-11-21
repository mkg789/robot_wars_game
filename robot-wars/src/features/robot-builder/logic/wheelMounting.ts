import { Euler, Vector3 } from "three";

import type { RobotPart, WheelDefinition } from "../types/robot.types";
import { getMotorShaftMountOffset } from "./mounting";

export function getWheelRelativeMountPosition(
  motor: RobotPart,
  wheel: WheelDefinition
): [number, number, number] {
  const shaftOffset = getMotorShaftMountOffset(motor);
  return [
    shaftOffset[0] + wheel.width / 2,
    shaftOffset[1],
    shaftOffset[2],
  ];
}

export function getWheelWorldMountTransform(
  motor: RobotPart,
  wheel: WheelDefinition
): {
  position: [number, number, number];
  rotation: [number, number, number];
  relativePosition: [number, number, number];
} {
  const relativePosition = getWheelRelativeMountPosition(motor, wheel);
  const worldOffset = new Vector3(...relativePosition).applyEuler(
    new Euler(...motor.rotation, "XYZ")
  );

  return {
    position: [
      motor.position[0] + worldOffset.x,
      motor.position[1] + worldOffset.y,
      motor.position[2] + worldOffset.z,
    ],
    rotation: [...motor.rotation],
    relativePosition,
  };
}
