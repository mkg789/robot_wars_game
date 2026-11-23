import type { WheelDefinition } from "../types/robot.types";

const compatibleMotorIds = [
  "small-dc",
  "standard-dc",
  "high-torque-dc",
] as const;

export const wheelCatalogue: WheelDefinition[] = [
  {
    id: "standard-rubber",
    name: "Standard Rubber Wheel",
    description: "Versatile rubber tire for everyday robot builds.",
    diameter: 0.22,
    width: 0.07,
    weight: 0.16,
    category: "Rubber",
    color: "#20242b",
    compatibleMotorIds: [...compatibleMotorIds],
    geometry: {
      shape: "cylinder",
      diameter: 0.22,
      axialWidth: 0.07,
      axis: "x",
    },
    massKg: 0.16,
    engineeringSpec: {
      category: "wheel",
      treadType: "rubber",
      fieldProvenance: {
        treadType: {
          method: "estimated",
          basis: "Adapted from catalogue category 'Rubber' and physical description",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:wheel:standard-rubber",
        notes:
          "Generic game preset wheel (220mm diameter, 70mm width). Not verified against an official manufacturer datasheet; hub bore dimensions, mechanical coupling tolerances, and traction coefficients are unverified and left undefined.",
      },
    },
  },
  {
    id: "heavy-duty",
    name: "Heavy-Duty Wheel",
    description: "Wider, reinforced tire for heavier assemblies.",
    diameter: 0.28,
    width: 0.1,
    weight: 0.32,
    category: "Heavy-duty",
    color: "#171a20",
    compatibleMotorIds: ["standard-dc", "high-torque-dc"],
    geometry: {
      shape: "cylinder",
      diameter: 0.28,
      axialWidth: 0.1,
      axis: "x",
    },
    massKg: 0.32,
    engineeringSpec: {
      category: "wheel",
      treadType: "polyurethane",
      fieldProvenance: {
        treadType: {
          method: "estimated",
          basis: "Adapted from catalogue category 'Heavy-duty' reinforced tire specification",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:wheel:heavy-duty",
        notes:
          "Generic game preset wheel (280mm diameter, 100mm width). Not verified against an official manufacturer datasheet; hub bore dimensions, mechanical coupling tolerances, and traction coefficients are unverified and left undefined.",
      },
    },
  },
  {
    id: "grip",
    name: "Grip Wheel",
    description: "Soft high-grip tread for improved traction.",
    diameter: 0.24,
    width: 0.09,
    weight: 0.24,
    category: "Grip",
    color: "#30343b",
    compatibleMotorIds: [...compatibleMotorIds],
    geometry: {
      shape: "cylinder",
      diameter: 0.24,
      axialWidth: 0.09,
      axis: "x",
    },
    massKg: 0.24,
    engineeringSpec: {
      category: "wheel",
      treadType: "rubber",
      fieldProvenance: {
        treadType: {
          method: "estimated",
          basis: "Adapted from catalogue category 'Grip' soft high-traction tread specification",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:wheel:grip",
        notes:
          "Generic game preset wheel (240mm diameter, 90mm width). Not verified against an official manufacturer datasheet; hub bore dimensions, mechanical coupling tolerances, and traction coefficients are unverified and left undefined.",
      },
    },
  },
  {
    id: "small-omni",
    name: "Small Omni Wheel",
    description: "Compact omni-directional wheel with side rollers.",
    diameter: 0.16,
    width: 0.055,
    weight: 0.12,
    category: "Omni",
    color: "#272b32",
    compatibleMotorIds: ["small-dc", "standard-dc"],
    geometry: {
      shape: "cylinder",
      diameter: 0.16,
      axialWidth: 0.055,
      axis: "x",
    },
    massKg: 0.12,
    engineeringSpec: {
      category: "wheel",
      treadType: "omni-directional",
      fieldProvenance: {
        treadType: {
          method: "estimated",
          basis: "Adapted from catalogue category 'Omni' multi-directional roller wheel specification",
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: false,
        source: "catalogue:wheel:small-omni",
        notes:
          "Generic game preset wheel (160mm diameter, 55mm width). Not verified against an official manufacturer datasheet; hub bore dimensions, mechanical coupling tolerances, and traction coefficients are unverified and left undefined.",
      },
    },
  },
];
