import type {
  ControllerDefinition,
  FoundationConfig,
} from "../types/robot.types";

export type ControllerMountTransform = {
  position: [number, number, number];
  relativePosition: [number, number, number];
};

export function getControllerMountingTransform(
  controller: ControllerDefinition,
  foundation: FoundationConfig
): ControllerMountTransform {
  const foundationTop = foundation.height +
    (foundation.includeTopPlate ? 0.15 : 0);
  const centerY = foundationTop + controller.dimensions.height * 0.5;
  const offsetZ = Math.min(0.25, foundation.width * 0.2);

  return {
    position: [0, centerY, offsetZ],
    relativePosition: [0, centerY - foundation.height * 0.5, offsetZ],
  };
}
