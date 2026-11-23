import type { MotorDefinition } from "../types/robot.types";

export const motorCatalogue: MotorDefinition[] = [
  {
    id: "small-dc",
    name: "Small DC Gear Motor",
    description: "Compact drive motor for lightweight robots.",
    dimensions: [0.28, 0.26, 0.34],
    weight: 0.22,
    rpm: 180,
    torque: 0.35,
    mountingFootprint: [0.42, 0.34],
    color: "#ef4444",
    geometry: {
      shape: "box",
      length: 0.28,
      height: 0.26,
      width: 0.34,
    },
    massKg: 0.22,
    mechanical: {
      stallTorqueNm: 0.35,
      noLoadRpm: 180,
    },
    engineeringSpec: {
      category: "motor",
      technology: "brushed-dc",
      mechanical: {
        stallTorqueNm: 0.35,
        noLoadSpeedRpm: 180,
        provenance: {
          method: "datasheet",
          verified: false,
          source: "catalogue:motor:small-dc",
          notes:
            "Legacy catalogue preset mechanical values (0.35 N·m stall torque, 180 RPM no-load speed). Rated operating points, gear ratio, and efficiency are unverified and left undefined.",
        },
      },
      mounting: {
        patternType: "face-mount",
        footprintDimensionsM: [0.42, 0, 0.34],
      },
      fieldProvenance: {
        "mechanical.stallTorqueNm": {
          method: "estimated",
          basis: "Legacy catalogue preset value",
          notes: "Stall torque represents arbitrary game preset",
        },
        "mechanical.noLoadSpeedRpm": {
          method: "estimated",
          basis: "Legacy catalogue preset value",
          notes: "No-load RPM represents arbitrary game preset",
        },
        "mounting.footprintDimensionsM": {
          method: "estimated",
          basis: "Derived from catalogue mountingFootprint [0.42, 0.34]",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:motor:small-dc",
        notes:
          "Generic game preset DC gear motor (180 RPM, 0.35 N·m). Not verified against an official manufacturer datasheet; electrical parameters, gearhead ratios, efficiency, and shaft geometry are unverified and left undefined.",
      },
    },
  },
  {
    id: "standard-dc",
    name: "Standard DC Gear Motor",
    description: "Balanced motor for general-purpose mobile bases.",
    dimensions: [0.38, 0.34, 0.42],
    weight: 0.48,
    rpm: 150,
    torque: 0.8,
    mountingFootprint: [0.54, 0.42],
    color: "#f97316",
    geometry: {
      shape: "box",
      length: 0.38,
      height: 0.34,
      width: 0.42,
    },
    massKg: 0.48,
    mechanical: {
      stallTorqueNm: 0.8,
      noLoadRpm: 150,
    },
    engineeringSpec: {
      category: "motor",
      technology: "brushed-dc",
      mechanical: {
        stallTorqueNm: 0.8,
        noLoadSpeedRpm: 150,
        provenance: {
          method: "datasheet",
          verified: false,
          source: "catalogue:motor:standard-dc",
          notes:
            "Legacy catalogue preset mechanical values (0.8 N·m stall torque, 150 RPM no-load speed). Rated operating points, gear ratio, and efficiency are unverified and left undefined.",
        },
      },
      mounting: {
        patternType: "face-mount",
        footprintDimensionsM: [0.54, 0, 0.42],
      },
      fieldProvenance: {
        "mechanical.stallTorqueNm": {
          method: "estimated",
          basis: "Legacy catalogue preset value",
          notes: "Stall torque represents arbitrary game preset",
        },
        "mechanical.noLoadSpeedRpm": {
          method: "estimated",
          basis: "Legacy catalogue preset value",
          notes: "No-load RPM represents arbitrary game preset",
        },
        "mounting.footprintDimensionsM": {
          method: "estimated",
          basis: "Derived from catalogue mountingFootprint [0.54, 0.42]",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:motor:standard-dc",
        notes:
          "Generic game preset DC gear motor (150 RPM, 0.8 N·m). Not verified against an official manufacturer datasheet; electrical parameters, gearhead ratios, efficiency, and shaft geometry are unverified and left undefined.",
      },
    },
  },
  {
    id: "high-torque-dc",
    name: "High-Torque DC Gear Motor",
    description: "Heavy-duty motor for larger or demanding builds.",
    dimensions: [0.46, 0.42, 0.5],
    weight: 0.82,
    rpm: 90,
    torque: 1.6,
    mountingFootprint: [0.66, 0.52],
    color: "#dc2626",
    geometry: {
      shape: "box",
      length: 0.46,
      height: 0.42,
      width: 0.5,
    },
    massKg: 0.82,
    mechanical: {
      stallTorqueNm: 1.6,
      noLoadRpm: 90,
    },
    engineeringSpec: {
      category: "motor",
      technology: "brushed-dc",
      mechanical: {
        stallTorqueNm: 1.6,
        noLoadSpeedRpm: 90,
        provenance: {
          method: "datasheet",
          verified: false,
          source: "catalogue:motor:high-torque-dc",
          notes:
            "Legacy catalogue preset mechanical values (1.6 N·m stall torque, 90 RPM no-load speed). Rated operating points, gear ratio, and efficiency are unverified and left undefined.",
        },
      },
      mounting: {
        patternType: "face-mount",
        footprintDimensionsM: [0.66, 0, 0.52],
      },
      fieldProvenance: {
        "mechanical.stallTorqueNm": {
          method: "estimated",
          basis: "Legacy catalogue preset value",
          notes: "Stall torque represents arbitrary game preset",
        },
        "mechanical.noLoadSpeedRpm": {
          method: "estimated",
          basis: "Legacy catalogue preset value",
          notes: "No-load RPM represents arbitrary game preset",
        },
        "mounting.footprintDimensionsM": {
          method: "estimated",
          basis: "Derived from catalogue mountingFootprint [0.66, 0.52]",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:motor:high-torque-dc",
        notes:
          "Generic game preset DC gear motor (90 RPM, 1.6 N·m). Not verified against an official manufacturer datasheet; electrical parameters, gearhead ratios, efficiency, and shaft geometry are unverified and left undefined.",
      },
    },
  },
];
