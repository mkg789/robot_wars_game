import type { StructuralDefinition } from "../types/robot.types";

const estimatedProvenance = (basis: string, notes: string) => ({
  method: "estimated" as const,
  basis,
  notes,
});

export const structuralCatalogue: StructuralDefinition[] = [
  {
    id: "l-bracket",
    name: "90° L-Bracket",
    category: "bracket",
    description:
      "Right-angle gusseted aluminum bracket for perpendicular rail, plate, and chassis mounting.",
    componentType: "Structural Block",
    visualShape: "l-bracket",
    dimensions: { length: 0.14, height: 0.14, width: 0.08 },
    minDimensions: { length: 0.06, height: 0.06, width: 0.04 },
    maxDimensions: { length: 0.45, height: 0.45, width: 0.35 },
    color: "#64748b",
    massKg: 0.18,
    geometry: {
      shape: "box",
      length: 0.14,
      height: 0.14,
      width: 0.08,
    },
    engineeringSpec: {
      category: "structural",
      role: "bulkhead",
      generalProvenance: estimatedProvenance(
        "catalogue:structural:l-bracket",
        "Generic Workshop L-bracket preset with nominal SI envelope."
      ),
    },
  },
  {
    id: "mounting-bracket",
    name: "Universal Mounting Bracket",
    category: "bracket",
    description:
      "U-channel flanged saddle bracket for securing actuators, rails, and sub-assemblies.",
    componentType: "Structural Block",
    visualShape: "mounting-bracket",
    dimensions: { length: 0.16, height: 0.12, width: 0.14 },
    minDimensions: { length: 0.08, height: 0.06, width: 0.06 },
    maxDimensions: { length: 0.5, height: 0.4, width: 0.5 },
    color: "#475569",
    massKg: 0.22,
    geometry: {
      shape: "box",
      length: 0.16,
      height: 0.12,
      width: 0.14,
    },
    engineeringSpec: {
      category: "structural",
      role: "bulkhead",
      generalProvenance: estimatedProvenance(
        "catalogue:structural:mounting-bracket",
        "Generic Workshop saddle bracket preset; bolt shear and thread ratings left undefined."
      ),
    },
  },
  {
    id: "flat-plate",
    name: "Flat Mounting Plate",
    category: "plate",
    description:
      "Rigid perforated aluminum carrier plate for electronics decks and upper payloads.",
    componentType: "Armor Plate",
    visualShape: "flat-plate",
    dimensions: { length: 0.6, height: 0.03, width: 0.45 },
    minDimensions: { length: 0.15, height: 0.01, width: 0.15 },
    maxDimensions: { length: 2.2, height: 0.12, width: 1.8 },
    color: "#6b7280",
    massKg: 0.42,
    geometry: {
      shape: "box",
      length: 0.6,
      height: 0.03,
      width: 0.45,
    },
    engineeringSpec: {
      category: "structural",
      role: "armor-plate",
      plateThicknessM: 0.03,
      generalProvenance: estimatedProvenance(
        "catalogue:structural:flat-plate",
        "Generic Workshop mounting plate preset."
      ),
    },
  },
  {
    id: "structural-rail",
    name: "Aluminum Structural Rail",
    category: "rail",
    description:
      "T-slotted extrusion rail running along robot length (+X) for modular component attachment.",
    componentType: "Structural Block",
    visualShape: "structural-rail",
    dimensions: { length: 1.2, height: 0.06, width: 0.06 },
    minDimensions: { length: 0.25, height: 0.03, width: 0.03 },
    maxDimensions: { length: 3.5, height: 0.2, width: 0.2 },
    color: "#94a3b8",
    massKg: 0.55,
    geometry: {
      shape: "box",
      length: 1.2,
      height: 0.06,
      width: 0.06,
    },
    engineeringSpec: {
      category: "structural",
      role: "chassis-frame",
      generalProvenance: estimatedProvenance(
        "catalogue:structural:structural-rail",
        "Generic extruded structural rail preset."
      ),
    },
  },
  {
    id: "crossbar",
    name: "Crossbar Support",
    category: "crossbar",
    description:
      "Lateral cross-brace spanning chassis width (+Z/-Z) to stiffen side rails and frame bays.",
    componentType: "Structural Block",
    visualShape: "crossbar",
    dimensions: { length: 0.08, height: 0.06, width: 1.2 },
    minDimensions: { length: 0.03, height: 0.03, width: 0.25 },
    maxDimensions: { length: 0.3, height: 0.2, width: 2.8 },
    color: "#7c8b99",
    massKg: 0.45,
    geometry: {
      shape: "box",
      length: 0.08,
      height: 0.06,
      width: 1.2,
    },
    engineeringSpec: {
      category: "structural",
      role: "bulkhead",
      generalProvenance: estimatedProvenance(
        "catalogue:structural:crossbar",
        "Generic lateral structural brace preset."
      ),
    },
  },
  {
    id: "hex-standoff",
    name: "Hex Standoff Post",
    category: "spacer",
    description:
      "Hexagonal vertical standoff column for elevating plates, electronics trays, or covers.",
    componentType: "Structural Block",
    visualShape: "hex-standoff",
    dimensions: { length: 0.04, height: 0.1, width: 0.04 },
    minDimensions: { length: 0.02, height: 0.02, width: 0.02 },
    maxDimensions: { length: 0.12, height: 0.4, width: 0.12 },
    color: "#cbd5e1",
    massKg: 0.06,
    geometry: {
      shape: "cylinder",
      diameter: 0.04,
      axialWidth: 0.1,
      axis: "y",
    },
    engineeringSpec: {
      category: "structural",
      role: "standoff",
      generalProvenance: estimatedProvenance(
        "catalogue:structural:hex-standoff",
        "Generic cylindrical hex standoff preset."
      ),
    },
  },
  {
    id: "spacer",
    name: "Chassis Spacer Collar",
    category: "spacer",
    description:
      "Compact cylindrical spacer bushing for fine vertical offset or shaft/bracket clearance.",
    componentType: "Structural Block",
    visualShape: "spacer",
    dimensions: { length: 0.05, height: 0.04, width: 0.05 },
    minDimensions: { length: 0.02, height: 0.01, width: 0.02 },
    maxDimensions: { length: 0.15, height: 0.2, width: 0.15 },
    color: "#94a3b8",
    massKg: 0.03,
    geometry: {
      shape: "cylinder",
      diameter: 0.05,
      axialWidth: 0.04,
      axis: "y",
    },
    engineeringSpec: {
      category: "structural",
      role: "standoff",
      generalProvenance: estimatedProvenance(
        "catalogue:structural:spacer",
        "Generic cylindrical spacer preset."
      ),
    },
  },
  {
    id: "box-beam",
    name: "Structural Box Beam",
    category: "beam",
    description:
      "Heavy-wall square hollow structural beam for high-load booms and sub-frames.",
    componentType: "Structural Block",
    visualShape: "box-beam",
    dimensions: { length: 0.85, height: 0.09, width: 0.09 },
    minDimensions: { length: 0.2, height: 0.04, width: 0.04 },
    maxDimensions: { length: 3.5, height: 0.3, width: 0.3 },
    color: "#526071",
    massKg: 0.62,
    geometry: {
      shape: "box",
      length: 0.85,
      height: 0.09,
      width: 0.09,
    },
    engineeringSpec: {
      category: "structural",
      role: "chassis-frame",
      generalProvenance: estimatedProvenance(
        "catalogue:structural:box-beam",
        "Generic square box beam preset."
      ),
    },
  },
  {
    id: "adjustable-bar",
    name: "Slotted Mounting Bar",
    category: "rail",
    description:
      "Dual-slot adjustable carrier bar allowing flexible fore/aft or lateral hardware alignment.",
    componentType: "Structural Block",
    visualShape: "adjustable-bar",
    dimensions: { length: 0.72, height: 0.04, width: 0.1 },
    minDimensions: { length: 0.2, height: 0.02, width: 0.05 },
    maxDimensions: { length: 2.5, height: 0.15, width: 0.4 },
    color: "#38bdf8",
    massKg: 0.34,
    geometry: {
      shape: "box",
      length: 0.72,
      height: 0.04,
      width: 0.1,
    },
    engineeringSpec: {
      category: "structural",
      role: "chassis-frame",
      generalProvenance: estimatedProvenance(
        "catalogue:structural:adjustable-bar",
        "Generic slotted bar preset."
      ),
    },
  },
  {
    id: "reinforced-bumper",
    name: "Reinforced Front Bumper",
    category: "bumper",
    description:
      "Chamfered steel-style impact bar with rib stiffeners for frontal chassis protection.",
    componentType: "Front Bumper",
    visualShape: "reinforced-bumper",
    dimensions: { length: 0.14, height: 0.18, width: 1.35 },
    minDimensions: { length: 0.06, height: 0.08, width: 0.5 },
    maxDimensions: { length: 0.4, height: 0.45, width: 2.8 },
    color: "#f59e0b",
    massKg: 0.85,
    geometry: {
      shape: "box",
      length: 0.14,
      height: 0.18,
      width: 1.35,
    },
    engineeringSpec: {
      category: "structural",
      role: "protective-bumper",
      generalProvenance: estimatedProvenance(
        "catalogue:structural:reinforced-bumper",
        "Generic reinforced front bumper preset; impact energy ratings left undefined."
      ),
    },
  },
];
