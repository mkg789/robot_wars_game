import type {
  AttachmentInterface,
  FoundationMountingPatternType,
  MountingPatternConfig,
  MountingPatternOrientation,
  MountingPitchPreset,
} from "../types/robot.types";

/**
 * Selectable mounting pattern pitch presets in canonical SI meters.
 * Explicitly documented as user-configurable pattern presets, not universal hardware standards.
 */
export const MOUNTING_PITCH_PRESETS: readonly MountingPitchPreset[] = [
  {
    id: "pitch-10mm",
    label: "10 mm Pitch",
    pitchM: 0.01,
    note: "Configurable compact robotics grid preset (10 mm).",
  },
  {
    id: "pitch-15mm",
    label: "15 mm Pitch",
    pitchM: 0.015,
    note: "Configurable light-frame spacing preset (15 mm).",
  },
  {
    id: "pitch-20mm",
    label: "20 mm Pitch",
    pitchM: 0.02,
    note: "Configurable aluminum extrusion spacing preset (20 mm).",
  },
  {
    id: "pitch-25mm",
    label: "25 mm Pitch",
    pitchM: 0.025,
    note: "Configurable heavy structural spacing preset (25 mm).",
  },
  {
    id: "pitch-0.5in",
    label: "0.5 in (12.7 mm)",
    pitchM: 0.0127,
    note: "Configurable imperial hole-grid preset (0.5 inch = 12.7 mm).",
  },
];

export interface GeneratedMountingPoint {
  readonly id: string;
  readonly row: number;
  readonly col: number;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
}

export interface GeneratedMountingPatternResult {
  readonly isValid: boolean;
  readonly points: readonly GeneratedMountingPoint[];
  readonly totalLogicalCount: number;
  readonly wasPreviewCapped: boolean;
  readonly rows: number;
  readonly columns: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

const MAX_RENDERED_PATTERN_POINTS = 196;

export function getPatternOrientationEuler(
  orientation: MountingPatternOrientation
): readonly [number, number, number] {
  switch (orientation) {
    case "top":
      return [0, 0, 0];
    case "bottom":
      return [Math.PI, 0, 0];
    case "left":
      return [0, -Math.PI / 2, 0];
    case "right":
      return [0, Math.PI / 2, 0];
    case "front":
      return [0, 0, -Math.PI / 2];
    case "rear":
      return [0, 0, Math.PI / 2];
  }
}

export function createDefaultMountingPattern(params: {
  id?: string;
  label?: string;
  lengthM: number;
  widthM: number;
  originY?: number;
  spacingM?: number;
  type?: FoundationMountingPatternType;
}): MountingPatternConfig {
  const spacing = params.spacingM ?? 0.1;
  return {
    id: params.id ?? "foundation-mounting-grid",
    label: params.label ?? "Deck Mounting Grid",
    enabled: true,
    type: params.type ?? "grid",
    origin: [0, params.originY ?? 0, 0],
    orientation: "top",
    spacingXM: spacing,
    spacingZM: spacing,
    boundsLengthM: Math.max(0.1, params.lengthM * 0.85),
    boundsWidthM: Math.max(0.1, params.widthM * 0.85),
    holeDiameterM: 0.008,
    provenance: {
      method: "estimated",
      basis: "Configurable Workshop mounting pattern preset (not a verified vendor spec)",
    },
  };
}

/**
 * Deterministically generates mounting pattern hole / anchor positions within configured bounds.
 * Caps rendered marker density cleanly so dense 10 mm grids never spawn thousands of meshes.
 */
export function generateMountingPatternPoints(
  pattern: MountingPatternConfig
): GeneratedMountingPatternResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!pattern.enabled) {
    return {
      isValid: true,
      points: [],
      totalLogicalCount: 0,
      wasPreviewCapped: false,
      rows: 0,
      columns: 0,
      warnings,
      errors,
    };
  }

  if (
    !Number.isFinite(pattern.boundsLengthM) ||
    !Number.isFinite(pattern.boundsWidthM) ||
    pattern.boundsLengthM <= 0 ||
    pattern.boundsWidthM <= 0
  ) {
    errors.push(`Mounting pattern "${pattern.label}" requires positive finite bounds.`);
  }

  if (
    !Number.isFinite(pattern.spacingXM) ||
    pattern.spacingXM <= 0 ||
    (pattern.type === "grid" &&
      (!Number.isFinite(pattern.spacingZM) || pattern.spacingZM <= 0))
  ) {
    errors.push(`Mounting pattern "${pattern.label}" requires positive pitch spacing.`);
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      points: [],
      totalLogicalCount: 0,
      wasPreviewCapped: false,
      rows: 0,
      columns: 0,
      warnings,
      errors,
    };
  }

  const rotation = getPatternOrientationEuler(pattern.orientation);
  const points: GeneratedMountingPoint[] = [];

  if (pattern.type === "custom") {
    const customList = pattern.customPoints ?? [[0, 0]];
    const totalLogicalCount = customList.length;
    customList.slice(0, MAX_RENDERED_PATTERN_POINTS).forEach(([u, v], idx) => {
      if (
        Math.abs(u) > pattern.boundsLengthM * 0.5 + 1e-4 ||
        Math.abs(v) > pattern.boundsWidthM * 0.5 + 1e-4
      ) {
        warnings.push(`Custom pattern hole #${idx + 1} lies outside declared pattern bounds.`);
      }
      points.push({
        id: `${pattern.id}-pt-${idx}`,
        row: 0,
        col: idx,
        position: [
          pattern.origin[0] + u,
          pattern.origin[1],
          pattern.origin[2] + v,
        ],
        rotation,
      });
    });
    return {
      isValid: true,
      points,
      totalLogicalCount,
      wasPreviewCapped: totalLogicalCount > MAX_RENDERED_PATTERN_POINTS,
      rows: 1,
      columns: totalLogicalCount,
      warnings: Array.from(new Set(warnings)),
      errors,
    };
  }

  const maxCols = Math.max(
    1,
    pattern.columns ?? Math.floor(pattern.boundsLengthM / pattern.spacingXM) + 1
  );
  const maxRows =
    pattern.type === "linear" || pattern.type === "t-slot"
      ? Math.max(1, pattern.rows ?? 2)
      : Math.max(
          1,
          pattern.rows ?? Math.floor(pattern.boundsWidthM / pattern.spacingZM) + 1
        );

  const actualSpanX = (maxCols - 1) * pattern.spacingXM;
  const actualSpanZ = (maxRows - 1) * pattern.spacingZM;
  if (
    actualSpanX > pattern.boundsLengthM + 1e-4 ||
    actualSpanZ > pattern.boundsWidthM + 1e-4
  ) {
    warnings.push(
      `Pattern span (${actualSpanX.toFixed(2)} × ${actualSpanZ.toFixed(2)} m) exceeds host surface bounds.`
    );
  }

  const totalLogicalCount = maxRows * maxCols;
  const stride =
    totalLogicalCount > MAX_RENDERED_PATTERN_POINTS
      ? Math.ceil(Math.sqrt(totalLogicalCount / MAX_RENDERED_PATTERN_POINTS))
      : 1;

  if (stride > 1) {
    warnings.push(
      `High-density pattern (${totalLogicalCount} holes) preview-sampled at every ${stride}× step to preserve viewport performance.`
    );
  }

  const startX = pattern.origin[0] - actualSpanX * 0.5;
  const startZ = pattern.origin[2] - actualSpanZ * 0.5;

  for (let r = 0; r < maxRows; r += stride) {
    for (let c = 0; c < maxCols; c += stride) {
      if (points.length >= MAX_RENDERED_PATTERN_POINTS) break;
      const x = startX + c * pattern.spacingXM;
      const z = startZ + r * pattern.spacingZM;
      points.push({
        id: `${pattern.id}-r${r}-c${c}`,
        row: r,
        col: c,
        position: [x, pattern.origin[1], z],
        rotation,
      });
    }
  }

  return {
    isValid: true,
    points,
    totalLogicalCount,
    wasPreviewCapped: stride > 1,
    rows: maxRows,
    columns: maxCols,
    warnings: Array.from(new Set(warnings)),
    errors,
  };
}

/**
 * Exposes representative anchor interfaces (center + corner pattern nodes) for attachment compatibility.
 */
export function patternToAttachmentInterfaces(
  pattern: MountingPatternConfig
): AttachmentInterface[] {
  const result = generateMountingPatternPoints(pattern);
  if (!result.isValid || result.points.length === 0) return [];

  return [
    {
      id: `${pattern.id}-primary`,
      label: `${pattern.label} (${result.rows}×${result.columns} @ ${(pattern.spacingXM * 1000).toFixed(0)}mm)`,
      kind: pattern.type === "t-slot" ? "rail-slot" : "plate-mount",
      position: [...pattern.origin],
      rotation: [...getPatternOrientationEuler(pattern.orientation)],
      compatibleWith: [
        "plate-mount",
        "bracket-face",
        "rail-slot",
        "generic-structural",
        "motor-mount",
      ],
      compatibilityStatus: "compatible",
      dimensionConstraint: {
        maxLengthM: pattern.boundsLengthM,
        maxWidthM: pattern.boundsWidthM,
      },
      provenance: pattern.provenance ?? {
        method: "estimated",
        basis: "Generated from configurable mounting pattern",
      },
      interfaceCategory: "pattern",
      mountingPattern: pattern,
    },
  ];
}
