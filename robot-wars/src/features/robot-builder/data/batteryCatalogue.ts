import type { BatteryDefinition } from "../types/robot.types";

export const batteryCatalogue: BatteryDefinition[] = [
  {
    id: "compact-lipo",
    name: "Compact LiPo",
    chemistry: "LiPo",
    voltage: 7.4,
    capacityMah: 1500,
    dimensions: { length: 0.16, width: 0.07, height: 0.035 },
    weight: 0.12,
    color: "#d97706",
  },
  {
    id: "standard-lipo",
    name: "Standard LiPo",
    chemistry: "LiPo",
    voltage: 11.1,
    capacityMah: 2200,
    dimensions: { length: 0.2, width: 0.09, height: 0.04 },
    weight: 0.22,
    color: "#b45309",
  },
  {
    id: "heavy-duty-lipo",
    name: "Heavy Duty LiPo",
    chemistry: "LiPo",
    voltage: 14.8,
    capacityMah: 5000,
    dimensions: { length: 0.24, width: 0.12, height: 0.055 },
    weight: 0.46,
    color: "#7c2d12",
  },
];
