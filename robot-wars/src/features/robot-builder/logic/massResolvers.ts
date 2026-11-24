/**
 * Pure analytical utility for normalizing and resolving component and assembly mass.
 *
 * Precedence:
 * 1. Canonical runtime mass: `part.massKg`
 * 2. Legacy fallback mass: `part.mass`
 *
 * Validation rules:
 * - Mass must be strictly positive (> 0) and finite.
 * - Missing, zero, negative, NaN, and infinite masses are rejected with structured failure reasons.
 * - If `massKg` is invalid (e.g. 0, negative, NaN) but a valid legacy `mass` exists,
 *   the valid legacy mass is recovered and flagged.
 *
 * NOTE: Pure, deterministic utility with zero external dependencies (no React, Three.js, Zustand, or DOM).
 */

export type MassResolutionSource = "massKg" | "legacy-mass" | "none";

export type MassResolutionFailureReason =
  | "missing"
  | "zero"
  | "negative"
  | "non-finite";

export interface MassSource {
  readonly id?: string;
  readonly name?: string;
  readonly massKg?: number | null;
  readonly mass?: number | null;
}

export type ComponentMassResolution = {
  readonly partId?: string;
  readonly partName?: string;
  readonly isValid: boolean;
  /** Resolved mass in canonical kilograms (0 if invalid) */
  readonly massKg: number;
  /** Raw input value that was evaluated (for logging / warnings) */
  readonly rawValue: number | undefined | null;
  /** Field source from which mass was resolved */
  readonly source: MassResolutionSource;
  /** Structured failure reason if invalid */
  readonly failureReason?: MassResolutionFailureReason;
  /** Human-readable explanation / warning string */
  readonly warning?: string;
};

export type AssemblyMassResolution = {
  /** Total mass of all valid components in canonical kilograms */
  readonly totalMassKg: number;
  /** All successfully resolved components */
  readonly validComponents: ComponentMassResolution[];
  /** All rejected components with non-positive, non-finite, or missing mass */
  readonly invalidComponents: ComponentMassResolution[];
  /** Combined list of warnings for invalid components or fallback recoveries */
  readonly warnings: string[];
};

function classifyFailureReason(
  value: number | undefined | null
): MassResolutionFailureReason {
  if (value === undefined || value === null) {
    return "missing";
  }
  if (!Number.isFinite(value)) {
    return "non-finite";
  }
  if (value === 0) {
    return "zero";
  }
  if (value < 0) {
    return "negative";
  }
  return "missing";
}

/**
 * Resolves component mass in canonical kilograms from canonical `massKg` or legacy `mass`.
 */
export function resolveComponentMass(part: MassSource): ComponentMassResolution {
  const partName = part.name ?? part.id ?? "Unknown Component";
  const partId = part.id;

  // 1. Check canonical massKg
  const hasMassKg = part.massKg !== undefined && part.massKg !== null;
  if (hasMassKg) {
    const rawVal = part.massKg!;
    if (typeof rawVal === "number" && Number.isFinite(rawVal) && rawVal > 0) {
      return {
        partId,
        partName,
        isValid: true,
        massKg: rawVal,
        rawValue: rawVal,
        source: "massKg",
      };
    }

    // massKg was specified but is non-positive or non-finite.
    // Check if a valid legacy fallback exists.
    if (
      part.mass !== undefined &&
      part.mass !== null &&
      typeof part.mass === "number" &&
      Number.isFinite(part.mass) &&
      part.mass > 0
    ) {
      return {
        partId,
        partName,
        isValid: true,
        massKg: part.mass,
        rawValue: part.mass,
        source: "legacy-mass",
        warning: `Component "${partName}" (${partId ?? "unknown"}) had invalid canonical massKg (${rawVal}); recovered valid legacy mass (${part.mass} kg).`,
      };
    }

    // Both or primary massKg is invalid
    const reason = classifyFailureReason(rawVal);
    return {
      partId,
      partName,
      isValid: false,
      massKg: 0,
      rawValue: rawVal,
      source: "massKg",
      failureReason: reason,
      warning: `Component "${partName}" (${partId ?? "unknown"}) has invalid mass (${rawVal}): ${reason}.`,
    };
  }

  // 2. Fall back to legacy mass
  const hasLegacyMass = part.mass !== undefined && part.mass !== null;
  if (hasLegacyMass) {
    const rawVal = part.mass!;
    if (typeof rawVal === "number" && Number.isFinite(rawVal) && rawVal > 0) {
      return {
        partId,
        partName,
        isValid: true,
        massKg: rawVal,
        rawValue: rawVal,
        source: "legacy-mass",
      };
    }

    const reason = classifyFailureReason(rawVal);
    return {
      partId,
      partName,
      isValid: false,
      massKg: 0,
      rawValue: rawVal,
      source: "legacy-mass",
      failureReason: reason,
      warning: `Component "${partName}" (${partId ?? "unknown"}) has invalid legacy mass (${rawVal}): ${reason}.`,
    };
  }

  // 3. Both missing
  return {
    partId,
    partName,
    isValid: false,
    massKg: 0,
    rawValue: undefined,
    source: "none",
    failureReason: "missing",
    warning: `Component "${partName}" (${partId ?? "unknown"}) has missing mass data.`,
  };
}

/**
 * Pure aggregator that resolves total valid assembly mass across an array of components.
 */
export function resolveAssemblyMass(
  parts: readonly MassSource[]
): AssemblyMassResolution {
  const validComponents: ComponentMassResolution[] = [];
  const invalidComponents: ComponentMassResolution[] = [];
  const warnings: string[] = [];

  let totalMassKg = 0;

  for (const part of parts) {
    const res = resolveComponentMass(part);
    if (res.isValid) {
      validComponents.push(res);
      totalMassKg += res.massKg;
      if (res.warning) {
        warnings.push(res.warning);
      }
    } else {
      invalidComponents.push(res);
      if (res.warning) {
        warnings.push(res.warning);
      }
    }
  }

  return {
    totalMassKg,
    validComponents,
    invalidComponents,
    warnings,
  };
}
