import type {
  BatteryDefinition,
  FoundationConfig,
} from "../types/robot.types";

export type BatteryMountTransform = {
  position: [number, number, number];
  relativePosition: [number, number, number];
};

export function getBatteryMountingTransform(
  battery: BatteryDefinition,
  foundation: FoundationConfig
): BatteryMountTransform {
  const foundationTop = foundation.height +
    (foundation.includeTopPlate ? 0.15 : 0);
  const centerY = foundationTop + battery.dimensions.height * 0.5;

  return {
    position: [0, centerY, 0],
    relativePosition: [0, centerY - foundation.height * 0.5, 0],
  };
}
