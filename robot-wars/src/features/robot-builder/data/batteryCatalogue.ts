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
    geometry: {
      shape: "box",
      length: 0.16,
      height: 0.035,
      width: 0.07,
    },
    massKg: 0.12,
    electrical: {
      nominalVoltageV: 7.4,
      capacityMah: 1500,
    },
    engineeringSpec: {
      category: "battery",
      chemistry: "lipo",
      cellCountS: 2,
      parallelCountP: 1,
      electrical: {
        nominalVoltageV: 7.4,
        fullyChargedVoltageV: 8.4,
        cutoffVoltageV: 6.0,
        capacityMah: 1500,
        provenance: {
          method: "datasheet",
          verified: false,
          source: "catalogue:battery:compact-lipo",
          notes:
            "Generic game preset battery. Nominal voltage (7.4V) and capacity (1500mAh) from catalogue preset; full charge (8.4V) and cutoff (6.0V) derived from standard 2S LiPo cell thresholds (4.2V max, 3.0V cutoff). C-ratings and internal resistance are omitted to avoid fabrication.",
        },
      },
      fieldProvenance: {
        cellCountS: {
          method: "estimated",
          basis: "Derived from nominal 7.4V / 3.7V per LiPo cell",
          notes: "2S series configuration",
        },
        parallelCountP: {
          method: "estimated",
          basis: "Standard single-string battery pack construction",
          notes: "1P parallel configuration",
        },
        "electrical.fullyChargedVoltageV": {
          method: "estimated",
          basis: "Calculated as 2S × 4.2V/cell maximum charge voltage",
        },
        "electrical.cutoffVoltageV": {
          method: "estimated",
          basis: "Calculated as 2S × 3.0V/cell minimum discharge floor",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:battery:compact-lipo",
        notes:
          "Generic game preset battery (2S 7.4V 1500mAh). Not verified against an official manufacturer datasheet; continuous/peak C-ratings, internal resistance, and connector type are unverified and left undefined.",
      },
    },
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
    geometry: {
      shape: "box",
      length: 0.2,
      height: 0.04,
      width: 0.09,
    },
    massKg: 0.22,
    electrical: {
      nominalVoltageV: 11.1,
      capacityMah: 2200,
    },
    engineeringSpec: {
      category: "battery",
      chemistry: "lipo",
      cellCountS: 3,
      parallelCountP: 1,
      electrical: {
        nominalVoltageV: 11.1,
        fullyChargedVoltageV: 12.6,
        cutoffVoltageV: 9.0,
        capacityMah: 2200,
        provenance: {
          method: "datasheet",
          verified: false,
          source: "catalogue:battery:standard-lipo",
          notes:
            "Generic game preset battery. Nominal voltage (11.1V) and capacity (2200mAh) from catalogue preset; full charge (12.6V) and cutoff (9.0V) derived from standard 3S LiPo cell thresholds (4.2V max, 3.0V cutoff). C-ratings and internal resistance are omitted to avoid fabrication.",
        },
      },
      fieldProvenance: {
        cellCountS: {
          method: "estimated",
          basis: "Derived from nominal 11.1V / 3.7V per LiPo cell",
          notes: "3S series configuration",
        },
        parallelCountP: {
          method: "estimated",
          basis: "Standard single-string battery pack construction",
          notes: "1P parallel configuration",
        },
        "electrical.fullyChargedVoltageV": {
          method: "estimated",
          basis: "Calculated as 3S × 4.2V/cell maximum charge voltage",
        },
        "electrical.cutoffVoltageV": {
          method: "estimated",
          basis: "Calculated as 3S × 3.0V/cell minimum discharge floor",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:battery:standard-lipo",
        notes:
          "Generic game preset battery (3S 11.1V 2200mAh). Not verified against an official manufacturer datasheet; continuous/peak C-ratings, internal resistance, and connector type are unverified and left undefined.",
      },
    },
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
    geometry: {
      shape: "box",
      length: 0.24,
      height: 0.055,
      width: 0.12,
    },
    massKg: 0.46,
    electrical: {
      nominalVoltageV: 14.8,
      capacityMah: 5000,
    },
    engineeringSpec: {
      category: "battery",
      chemistry: "lipo",
      cellCountS: 4,
      parallelCountP: 1,
      electrical: {
        nominalVoltageV: 14.8,
        fullyChargedVoltageV: 16.8,
        cutoffVoltageV: 12.0,
        capacityMah: 5000,
        provenance: {
          method: "datasheet",
          verified: false,
          source: "catalogue:battery:heavy-duty-lipo",
          notes:
            "Generic game preset battery. Nominal voltage (14.8V) and capacity (5000mAh) from catalogue preset; full charge (16.8V) and cutoff (12.0V) derived from standard 4S LiPo cell thresholds (4.2V max, 3.0V cutoff). C-ratings and internal resistance are omitted to avoid fabrication.",
        },
      },
      fieldProvenance: {
        cellCountS: {
          method: "estimated",
          basis: "Derived from nominal 14.8V / 3.7V per LiPo cell",
          notes: "4S series configuration",
        },
        parallelCountP: {
          method: "estimated",
          basis: "Standard single-string battery pack construction",
          notes: "1P parallel configuration",
        },
        "electrical.fullyChargedVoltageV": {
          method: "estimated",
          basis: "Calculated as 4S × 4.2V/cell maximum charge voltage",
        },
        "electrical.cutoffVoltageV": {
          method: "estimated",
          basis: "Calculated as 4S × 3.0V/cell minimum discharge floor",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:battery:heavy-duty-lipo",
        notes:
          "Generic game preset battery (4S 14.8V 5000mAh). Not verified against an official manufacturer datasheet; continuous/peak C-ratings, internal resistance, and connector type are unverified and left undefined.",
      },
    },
  },
];
