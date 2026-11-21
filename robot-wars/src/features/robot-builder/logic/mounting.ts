import { Euler, Vector3 } from "three";

import type { RobotPart } from "../types/robot.types";

export type MountCandidate = {
  motorId: string;
  wheelId: string;
};

export function getMotorShaftMountOffset(motor: RobotPart): [number, number, number] {
  const shaftLength = motor.size[0] * 0.55;
  return [motor.size[0] * 0.5 + shaftLength, 0, 0];
}

export function getMotorShaftMountPosition(
  motor: RobotPart,
  wheelOffset?: [number, number, number]
): [number, number, number] {
  const offset = wheelOffset ?? getMotorShaftMountOffset(motor);
  const worldOffset = new Vector3(...offset).applyEuler(
    new Euler(...motor.rotation, "XYZ")
  );

  return [
    motor.position[0] + worldOffset.x,
    motor.position[1] + worldOffset.y,
    motor.position[2] + worldOffset.z,
  ];
}
