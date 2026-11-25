import { createDefaultMountingPattern } from "./mountingPatterns";
import { getFoundationMountingInterfaces } from "./mountingInterfaces";
import type {
  AttachmentInterface,
  FoundationConfig,
  ProceduralFoundationArchitectureId,
  ProceduralFoundationConfig,
  RailProfileKind,
  RobotConnection,
  RobotPart,
  StructuralVisualShape,
} from "../types/robot.types";

export interface ProceduralArchitectureDefinition {
  readonly id: ProceduralFoundationArchitectureId;
  readonly name: string;
  readonly shortName: string;
  readonly icon: string;
  readonly description: string;
  readonly defaultDimensions: {
    readonly length: number;
    readonly width: number;
    readonly height: number;
    readonly thickness: number;
  };
}

export const PROCEDURAL_ARCHITECTURES: readonly ProceduralArchitectureDefinition[] = [
  {
    id: "perimeter-frame",
    name: "Perimeter Structural Frame",
    shortName: "Perimeter Frame",
    icon: "▢",
    description:
      "Modular front, rear, left, and right structural rails bridged by configurable crossmembers.",
    defaultDimensions: { length: 1.8, width: 1.4, height: 0.14, thickness: 0.02 },
  },
  {
    id: "t-slot-frame",
    name: "T-Slot Extrusion Frame",
    shortName: "T-Slot Frame",
    icon: "⊞",
    description:
      "Simplified extruded T-slot rails with crossmembers, corner brackets, and linear slot channels.",
    defaultDimensions: { length: 1.9, width: 1.45, height: 0.12, thickness: 0.02 },
  },
  {
    id: "patterned-frame",
    name: "Patterned Robotics Frame",
    shortName: "Patterned Frame",
    icon: "⸬",
    description:
      "Standardized perforated robotics channels with configurable pitch pattern and joining plates.",
    defaultDimensions: { length: 1.8, width: 1.4, height: 0.12, thickness: 0.02 },
  },
  {
    id: "flat-plate",
    name: "Flat Plate Chassis",
    shortName: "Flat Plate",
    icon: "▬",
    description:
      "CNC-cut structural base plate with optional weight cutouts, under-ribs, and configurable hole grid.",
    defaultDimensions: { length: 1.6, width: 1.3, height: 0.08, thickness: 0.03 },
  },
  {
    id: "sheet-metal-tray",
    name: "Sheet-Metal Folded Tray",
    shortName: "Sheet Tray",
    icon: "⊔",
    description:
      "Folded sheet base pan with configurable upright edge flanges, deck thickness, and mounting grid.",
    defaultDimensions: { length: 1.7, width: 1.35, height: 0.18, thickness: 0.015 },
  },
  {
    id: "hybrid",
    name: "Hybrid Reinforced Chassis",
    shortName: "Hybrid Frame",
    icon: "⊟",
    description:
      "Combined perimeter rails, internal crossmembers, mounting deck plate, brackets, and structural ribs.",
    defaultDimensions: { length: 2.0, width: 1.5, height: 0.18, thickness: 0.025 },
  },
];

export const RAIL_PROFILE_LABELS: Readonly<Record<RailProfileKind, string>> = {
  "square-tube": "Square Box Tube",
  "t-slot": "T-Slot Extrusion",
  "c-channel": "Perforated C-Channel",
  "flat-bar": "Heavy Flat Bar",
};

const ALUMINUM_EFFECTIVE_DENSITY_KG_M3 = 1450; // Hollow/slotted structural member effective bulk estimate

function estimateMemberMassKg(l: number, h: number, w: number, floor = 0.08): number {
  return Number(Math.max(floor, l * h * w * ALUMINUM_EFFECTIVE_DENSITY_KG_M3).toFixed(3));
}

export function createDefaultProceduralFoundationConfig(
  architecture: ProceduralFoundationArchitectureId = "perimeter-frame",
  dims?: { length?: number; width?: number; height?: number }
): ProceduralFoundationConfig {
  const meta =
    PROCEDURAL_ARCHITECTURES.find((a) => a.id === architecture) ??
    PROCEDURAL_ARCHITECTURES[0];
  const length = dims?.length ?? meta.defaultDimensions.length;
  const width = dims?.width ?? meta.defaultDimensions.width;
  const height = dims?.height ?? meta.defaultDimensions.height;
  const thickness = meta.defaultDimensions.thickness;

  const railProfile: RailProfileKind =
    architecture === "t-slot-frame"
      ? "t-slot"
      : architecture === "patterned-frame"
        ? "c-channel"
        : architecture === "flat-plate"
          ? "flat-bar"
          : "square-tube";

  return {
    architecture,
    length,
    width,
    height,
    thickness,
    railProfile,
    railWidth: architecture === "flat-plate" ? 0.05 : 0.08,
    railHeight: Math.min(height, architecture === "flat-plate" ? 0.05 : 0.09),
    includeFrontRail: architecture !== "flat-plate" && architecture !== "sheet-metal-tray",
    includeRearRail: architecture !== "flat-plate" && architecture !== "sheet-metal-tray",
    includeLeftRail: architecture !== "sheet-metal-tray",
    includeRightRail: architecture !== "sheet-metal-tray",
    crossmemberCount:
      architecture === "flat-plate" || architecture === "sheet-metal-tray" ? 0 : 2,
    crossmemberWidth: 0.07,
    crossmemberHeight: Math.min(height, 0.075),
    flanges: {
      front: architecture === "sheet-metal-tray",
      rear: architecture === "sheet-metal-tray",
      left: architecture === "sheet-metal-tray",
      right: architecture === "sheet-metal-tray",
      heightM: Math.max(0.06, Math.min(height, 0.16)),
      thicknessM: Math.min(0.03, Math.max(0.008, thickness)),
    },
    cutoutStyle: architecture === "flat-plate" ? "weight-relief" : "none",
    includeCornerBrackets:
      architecture === "t-slot-frame" || architecture === "hybrid",
    includeJoiningPlates:
      architecture === "patterned-frame" || architecture === "hybrid",
    includeReinforcementRibs:
      architecture === "flat-plate" || architecture === "hybrid",
    mountingPattern: createDefaultMountingPattern({
      id: `grid-${architecture}`,
      label:
        architecture === "t-slot-frame"
          ? "Extrusion Slot Grid"
          : architecture === "patterned-frame"
            ? "Patterned Hole Matrix"
            : "Chassis Mounting Grid",
      lengthM: length,
      widthM: width,
      originY: height * 0.5,
      spacingM: architecture === "patterned-frame" ? 0.025 : 0.12,
      type: architecture === "t-slot-frame" ? "t-slot" : "grid",
    }),
  };
}

export interface ProceduralValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export function validateProceduralFoundationConfig(
  cfg: ProceduralFoundationConfig
): ProceduralValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(cfg.length) || cfg.length < 0.35 || cfg.length > 6) {
    errors.push(`Foundation length (${cfg.length} m) must be between 0.35 m and 6.0 m.`);
  }
  if (!Number.isFinite(cfg.width) || cfg.width < 0.35 || cfg.width > 5) {
    errors.push(`Foundation width (${cfg.width} m) must be between 0.35 m and 5.0 m.`);
  }
  if (!Number.isFinite(cfg.height) || cfg.height < 0.02 || cfg.height > 1.5) {
    errors.push(`Foundation envelope height (${cfg.height} m) must be between 0.02 m and 1.5 m.`);
  }
  if (!Number.isFinite(cfg.thickness) || cfg.thickness <= 0 || cfg.thickness > cfg.height) {
    errors.push("Plate/base thickness must be positive and not exceed foundation height.");
  }

  if (
    cfg.architecture === "perimeter-frame" ||
    cfg.architecture === "t-slot-frame" ||
    cfg.architecture === "patterned-frame" ||
    cfg.architecture === "hybrid"
  ) {
    if (!Number.isFinite(cfg.railWidth) || cfg.railWidth <= 0.015 || cfg.railWidth * 2.2 >= Math.min(cfg.length, cfg.width)) {
      errors.push("Perimeter rail width is invalid or consumes the entire interior bay.");
    }
    if (!Number.isFinite(cfg.railHeight) || cfg.railHeight <= 0.015 || cfg.railHeight > cfg.height * 1.25) {
      errors.push("Rail profile height is invalid or exceeds foundation envelope height.");
    }
    const enabledRails = [
      cfg.includeFrontRail,
      cfg.includeRearRail,
      cfg.includeLeftRail,
      cfg.includeRightRail,
    ].filter(Boolean).length;
    if (enabledRails < 2) {
      errors.push("Frame architecture requires at least two opposing perimeter rails for structural continuity.");
    }
    if (cfg.crossmemberCount === 0 && enabledRails < 4) {
      warnings.push("Open frame without crossmembers or end rails lacks torsional stiffness.");
    }
  }

  if (cfg.architecture === "sheet-metal-tray") {
    if (!Number.isFinite(cfg.flanges.heightM) || cfg.flanges.heightM <= cfg.thickness) {
      errors.push("Sheet-metal tray flange height must exceed base sheet thickness.");
    }
    if (
      !cfg.flanges.front &&
      !cfg.flanges.rear &&
      !cfg.flanges.left &&
      !cfg.flanges.right
    ) {
      warnings.push("Sheet-metal tray has all edge flanges disabled (behaves like flat plate).");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

export interface ProceduralMemberGenerationResult {
  readonly rootPart: RobotPart;
  readonly memberParts: readonly RobotPart[];
  readonly memberConnections: readonly RobotConnection[];
}

function makeMemberVisualShape(profile: RailProfileKind): StructuralVisualShape {
  switch (profile) {
    case "t-slot":
      return "structural-rail";
    case "c-channel":
      return "adjustable-bar";
    case "square-tube":
      return "box-beam";
    case "flat-bar":
    default:
      return "flat-plate";
  }
}

/**
 * Deterministically builds a modular procedural foundation anchored on `"foundation-chassis"`,
 * generating real individual RobotPart structural members connected back to `"foundation-chassis"`.
 * Preserves canonical axes: +X front, +Y up, +Z left, -Z right.
 */
export function generateProceduralFoundationAssembly(
  foundation: FoundationConfig
): ProceduralMemberGenerationResult {
  const cfg =
    foundation.procedural ??
    createDefaultProceduralFoundationConfig("perimeter-frame", {
      length: foundation.length,
      width: foundation.width,
      height: foundation.height,
    });

  const length = foundation.length;
  const width = foundation.width;
  const height = foundation.height;
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const rootY = height * 0.5;

  const memberParts: RobotPart[] = [];
  const memberConnections: RobotConnection[] = [];

  const pushMember = (params: {
    id: string;
    name: string;
    role: RobotPart["foundationMemberRole"];
    type?: RobotPart["type"];
    visualShape: StructuralVisualShape;
    color: string;
    relPos: [number, number, number];
    size: [number, number, number];
    mountPointId: string;
    rotation?: [number, number, number];
    category?: RobotPart["structuralCategory"];
  }) => {
    const connId = `conn-${params.id}`;
    const massKg = estimateMemberMassKg(...params.size);
    const rot: [number, number, number] = params.rotation ?? [0, 0, 0];
    memberParts.push({
      id: params.id,
      name: params.name,
      type: params.type ?? "Structural Block",
      position: [params.relPos[0], rootY + params.relPos[1], params.relPos[2]],
      rotation: rot,
      size: params.size,
      color: params.color,
      mass: massKg,
      massKg,
      parentAttachmentId: connId,
      structuralVisualShape: params.visualShape,
      structuralCategory: params.category ?? "rail",
      foundationMemberRole: params.role,
      foundationMemberEditable: true,
      geometry: {
        shape: "box",
        length: params.size[0],
        height: params.size[1],
        width: params.size[2],
      },
      engineeringSpec: {
        category: "structural",
        role: params.role === "plate" ? "armor-plate" : "chassis-frame",
        generalProvenance: {
          method: "estimated",
          basis: `Procedural ${cfg.architecture} member generated from canonical foundation parameters`,
        },
      },
    });
    memberConnections.push({
      id: connId,
      sourceId: "foundation-chassis",
      targetId: params.id,
      parentId: "foundation-chassis",
      childId: params.id,
      parentMountPointId: params.mountPointId,
      childMountPointId: "rail-bottom",
      relativePosition: params.relPos,
      relativeRotation: rot,
      type: "Mechanical",
    });
  };

  const railShape = makeMemberVisualShape(cfg.railProfile);
  const railColor =
    cfg.railProfile === "t-slot"
      ? "#94a3b8"
      : cfg.railProfile === "c-channel"
        ? "#64748b"
        : "#475569";

  const railH = Math.min(height, cfg.railHeight);
  const railW = cfg.railWidth;
  const railRelY = -height * 0.5 + railH * 0.5;

  // Side & end rails for rail-based architectures
  if (cfg.architecture !== "sheet-metal-tray") {
    if (cfg.includeLeftRail) {
      pushMember({
        id: "foundation-member-left-rail",
        name: "Left Main Rail (+Z)",
        role: "rail",
        visualShape: railShape,
        color: railColor,
        relPos: [0, railRelY, halfW - railW * 0.5],
        size: [length, railH, railW],
        mountPointId: "foundation-left-rail",
        category: "rail",
      });
    }
    if (cfg.includeRightRail) {
      pushMember({
        id: "foundation-member-right-rail",
        name: "Right Main Rail (-Z)",
        role: "rail",
        visualShape: railShape,
        color: railColor,
        relPos: [0, railRelY, -(halfW - railW * 0.5)],
        size: [length, railH, railW],
        mountPointId: "foundation-right-rail",
        category: "rail",
      });
    }

    const endRailSpanZ = Math.max(0.2, width - (cfg.includeLeftRail && cfg.includeRightRail ? railW * 2 : 0));
    if (cfg.includeFrontRail) {
      pushMember({
        id: "foundation-member-front-rail",
        name: "Front Rail (+X)",
        role: "rail",
        visualShape: railShape,
        color: railColor,
        relPos: [halfL - railW * 0.5, railRelY, 0],
        size: [railW, railH, endRailSpanZ],
        mountPointId: "foundation-front-face",
        category: "crossbar",
      });
    }
    if (cfg.includeRearRail) {
      pushMember({
        id: "foundation-member-rear-rail",
        name: "Rear Rail (-X)",
        role: "rail",
        visualShape: railShape,
        color: railColor,
        relPos: [-(halfL - railW * 0.5), railRelY, 0],
        size: [railW, railH, endRailSpanZ],
        mountPointId: "foundation-rear-face",
        category: "crossbar",
      });
    }
  }

  // Crossmembers evenly spaced along X inside perimeter rails
  const crossSpanZ = Math.max(0.2, width - railW * 2);
  const crossCount = Math.max(0, Math.min(8, Math.round(cfg.crossmemberCount)));
  const crossH = Math.min(height, cfg.crossmemberHeight);
  const crossRelY = -height * 0.5 + crossH * 0.5;
  const usableSpanX = Math.max(0.2, length - railW * 4);
  for (let i = 0; i < crossCount; i++) {
    const t = crossCount === 1 ? 0 : (i / (crossCount - 1)) * 2 - 1;
    const xPos = crossCount === 1 ? 0 : t * (usableSpanX * 0.36);
    pushMember({
      id: `foundation-member-cross-${i + 1}`,
      name: `Crossmember ${i + 1}`,
      role: "crossmember",
      visualShape: "crossbar",
      color: "#7c8b99",
      relPos: [xPos, crossRelY, 0],
      size: [cfg.crossmemberWidth, crossH, crossSpanZ],
      mountPointId: "foundation-top-center",
      category: "crossbar",
    });
  }

  // Base plate or hybrid deck / sheet-metal pan
  if (
    cfg.architecture === "flat-plate" ||
    cfg.architecture === "sheet-metal-tray" ||
    cfg.architecture === "hybrid"
  ) {
    const plateH = Math.min(height, cfg.thickness);
    const plateRelY =
      cfg.architecture === "hybrid"
        ? railRelY + railH * 0.5 + plateH * 0.5
        : -height * 0.5 + plateH * 0.5;
    pushMember({
      id: "foundation-member-base-plate",
      name:
        cfg.architecture === "sheet-metal-tray"
          ? "Tray Base Pan"
          : cfg.architecture === "flat-plate"
            ? "Primary Chassis Plate"
            : "Hybrid Structural Deck",
      role: "plate",
      type: "Armor Plate",
      visualShape: "flat-plate",
      color: "#64748b",
      relPos: [0, plateRelY, 0],
      size: [
        cfg.architecture === "hybrid" ? length * 0.94 : length,
        plateH,
        cfg.architecture === "hybrid" ? width * 0.94 : width,
      ],
      mountPointId: "foundation-top-center",
      category: "plate",
    });
  }

  // Sheet-metal folded perimeter flanges
  if (cfg.architecture === "sheet-metal-tray") {
    const fh = Math.max(0.03, Math.min(height, cfg.flanges.heightM));
    const ft = Math.max(0.008, Math.min(0.05, cfg.flanges.thicknessM));
    const fRelY = -height * 0.5 + cfg.thickness + (fh - cfg.thickness) * 0.5;
    const fH = Math.max(0.02, fh - cfg.thickness);

    if (cfg.flanges.left) {
      pushMember({
        id: "foundation-member-flange-left",
        name: "Left Tray Flange (+Z)",
        role: "flange",
        type: "Armor Plate",
        visualShape: "adjustable-bar",
        color: "#6b7280",
        relPos: [0, fRelY, halfW - ft * 0.5],
        size: [length, fH, ft],
        mountPointId: "foundation-left-rail",
        category: "plate",
      });
    }
    if (cfg.flanges.right) {
      pushMember({
        id: "foundation-member-flange-right",
        name: "Right Tray Flange (-Z)",
        role: "flange",
        type: "Armor Plate",
        visualShape: "adjustable-bar",
        color: "#6b7280",
        relPos: [0, fRelY, -(halfW - ft * 0.5)],
        size: [length, fH, ft],
        mountPointId: "foundation-right-rail",
        category: "plate",
      });
    }
    if (cfg.flanges.front) {
      pushMember({
        id: "foundation-member-flange-front",
        name: "Front Tray Flange (+X)",
        role: "flange",
        type: "Armor Plate",
        visualShape: "adjustable-bar",
        color: "#6b7280",
        relPos: [halfL - ft * 0.5, fRelY, 0],
        size: [ft, fH, Math.max(0.1, width - ft * 2)],
        mountPointId: "foundation-front-face",
        category: "plate",
      });
    }
    if (cfg.flanges.rear) {
      pushMember({
        id: "foundation-member-flange-rear",
        name: "Rear Tray Flange (-X)",
        role: "flange",
        type: "Armor Plate",
        visualShape: "adjustable-bar",
        color: "#6b7280",
        relPos: [-(halfL - ft * 0.5), fRelY, 0],
        size: [ft, fH, Math.max(0.1, width - ft * 2)],
        mountPointId: "foundation-rear-face",
        category: "plate",
      });
    }
  }

  // Optional corner gusset brackets / joining plates
  if (cfg.includeCornerBrackets && cfg.architecture !== "flat-plate" && cfg.architecture !== "sheet-metal-tray") {
    const bSize: [number, number, number] = [0.14, Math.min(railH, 0.12), 0.12];
    const bx = halfL - railW - bSize[0] * 0.45;
    const bz = halfW - railW - bSize[2] * 0.45;
    const corners: Array<[string, string, number, number]> = [
      ["fl", "Front-Left Gusset", bx, bz],
      ["fr", "Front-Right Gusset", bx, -bz],
      ["rl", "Rear-Left Gusset", -bx, bz],
      ["rr", "Rear-Right Gusset", -bx, -bz],
    ];
    for (const [key, label, cx, cz] of corners) {
      pushMember({
        id: `foundation-member-bracket-${key}`,
        name: label,
        role: "bracket",
        visualShape: "l-bracket",
        color: "#475569",
        relPos: [cx, railRelY, cz],
        size: bSize,
        mountPointId: "foundation-top-center",
        category: "bracket",
      });
    }
  }

  if (cfg.includeJoiningPlates && (cfg.architecture === "patterned-frame" || cfg.architecture === "hybrid")) {
    const jpSize: [number, number, number] = [0.22, 0.018, 0.18];
    const jY = railRelY + railH * 0.5 + jpSize[1] * 0.5;
    pushMember({
      id: "foundation-member-join-front",
      name: "Front Joining Plate",
      role: "bracket",
      type: "Armor Plate",
      visualShape: "flat-plate",
      color: "#94a3b8",
      relPos: [halfL * 0.65, jY, 0],
      size: jpSize,
      mountPointId: "foundation-top-front",
      category: "plate",
    });
    pushMember({
      id: "foundation-member-join-rear",
      name: "Rear Joining Plate",
      role: "bracket",
      type: "Armor Plate",
      visualShape: "flat-plate",
      color: "#94a3b8",
      relPos: [-halfL * 0.65, jY, 0],
      size: jpSize,
      mountPointId: "foundation-top-rear",
      category: "plate",
    });
  }

  // Optional longitudinal reinforcement ribs (flat-plate & hybrid)
  if (cfg.includeReinforcementRibs && (cfg.architecture === "flat-plate" || cfg.architecture === "hybrid")) {
    const ribSize: [number, number, number] = [length * 0.78, 0.045, 0.035];
    const ribY = -height * 0.5 + cfg.thickness + ribSize[1] * 0.5;
    [-1, 1].forEach((side) => {
      pushMember({
        id: `foundation-member-rib-${side > 0 ? "left" : "right"}`,
        name: `Reinforcement Rib (${side > 0 ? "+Z" : "-Z"})`,
        role: "rib",
        visualShape: "box-beam",
        color: "#475569",
        relPos: [0, ribY, side * width * 0.24],
        size: ribSize,
        mountPointId: "foundation-top-center",
        category: "beam",
      });
    });
  }

  const archMeta = PROCEDURAL_ARCHITECTURES.find((a) => a.id === cfg.architecture);
  // Root chassis holds core hardware/gusset allowance (avoiding double counting individual members)
  const rootCoreMassKg = 0.25;

  const rootPart: RobotPart = {
    id: "foundation-chassis",
    name: archMeta?.name ?? "Procedural Chassis",
    type: "Structural Block",
    position: [0, rootY, 0],
    rotation: [0, 0, 0],
    size: [length, height, width],
    color: "#334155",
    mass: rootCoreMassKg,
    massKg: rootCoreMassKg,
    foundationModelId: foundation.modelId,
    mountingPatterns: cfg.mountingPattern ? [cfg.mountingPattern] : undefined,
    geometry: {
      shape: "box",
      length,
      height,
      width,
    },
    engineeringSpec: {
      category: "structural",
      role: "chassis-frame",
      generalProvenance: {
        method: "estimated",
        basis: `Procedural ${cfg.architecture} frame anchor envelope (${length.toFixed(2)} × ${width.toFixed(2)} m)`,
      },
    },
  };

  return {
    rootPart,
    memberParts,
    memberConnections,
  };
}

export function getProceduralMemberInterfaces(
  foundation: FoundationConfig,
  memberParts: readonly RobotPart[]
): AttachmentInterface[] {
  const baseInterfaces = getFoundationMountingInterfaces(foundation);
  const extras: AttachmentInterface[] = [];

  for (const member of memberParts) {
    if (!member.foundationMemberRole) continue;
    if (member.foundationMemberRole === "crossmember") {
      extras.push({
        id: `${member.id}-top`,
        label: `${member.name} Top Face`,
        kind: "rail-slot",
        position: [
          member.position[0],
          member.position[1] - foundation.height * 0.5 + member.size[1] * 0.5,
          member.position[2],
        ],
        rotation: [0, 0, 0],
        compatibleWith: ["rail-slot", "bracket-face", "plate-mount", "generic-structural", "motor-mount"],
        compatibilityStatus: "compatible",
        dimensionConstraint: {
          maxLengthM: member.size[0] * 1.4,
          maxWidthM: member.size[2],
          maxPayloadKg: 8,
        },
        provenance: {
          method: "estimated",
          basis: "Procedural crossmember top interface",
        },
      });
    }
  }

  return [...baseInterfaces, ...extras];
}
