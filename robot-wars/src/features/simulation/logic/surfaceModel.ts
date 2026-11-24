/**
 * Pure Ground and Surface Model for Robot Wars dynamic simulation.
 *
 * Provides:
 * - Extensible catalogue of environmental surface presets (steel, concrete, asphalt, wood, rubber, low-grip).
 * - Pure validation functions ensuring physical plausibility and contract invariants.
 * - Compatibility adapters resolving effective wheel-ground friction pairs while preserving existing baseline behavior.
 *
 * NOTE: Completely decoupled from React, Three.js, DOM, and UI rendering.
 */

import type {
  EffectiveFrictionResult,
  GroundSurface,
  GroundSurfaceValidationResult,
} from "../types/surface.types";

/**
 * Initial catalogue of standard simulation surface presets.
 *
 * NOTE: These are simulation presets representing nominal engineering estimates for
 * standard solid rubber tires on various dry surfaces. They are NOT claims of universal
 * real-world friction values or laboratory material specifications.
 */
export const SURFACE_PRESETS = {
  steel: {
    id: "steel",
    name: "Standard Arena Steel Floor",
    description:
      "Clean, dry smooth steel plate arena floor representing standard competition arena surfaces.",
    staticFrictionCoeff: 0.85,
    kineticFrictionCoeff: 0.7,
    provenance: {
      source: "assumed-simulation-preset",
      verified: false,
      notes:
        "Standard baseline arena surface for Robot Wars simulation. Matches existing 0.85 nominal rubber-on-steel default.",
    },
  },
  concrete: {
    id: "concrete",
    name: "Smooth Concrete",
    description: "Dry, smooth troweled industrial concrete floor.",
    staticFrictionCoeff: 0.9,
    kineticFrictionCoeff: 0.75,
    provenance: {
      source: "assumed-simulation-preset",
      verified: false,
      notes:
        "Estimated nominal values for standard solid rubber robot tires on dry, smooth concrete.",
    },
  },
  asphalt: {
    id: "asphalt",
    name: "Dry Asphalt",
    description: "Dry, compacted asphalt pavement with moderate microtexture.",
    staticFrictionCoeff: 0.95,
    kineticFrictionCoeff: 0.8,
    provenance: {
      source: "assumed-simulation-preset",
      verified: false,
      notes:
        "Estimated nominal values for solid rubber tires on clean, dry asphalt with moderate microtexture.",
    },
  },
  wood: {
    id: "wood",
    name: "Plywood / Hardwood Arena",
    description:
      "Smooth, dry plywood or hardwood arena flooring with low texture.",
    staticFrictionCoeff: 0.7,
    kineticFrictionCoeff: 0.55,
    provenance: {
      source: "assumed-simulation-preset",
      verified: false,
      notes:
        "Estimated nominal values for rubber tires on smooth, painted or bare plywood flooring.",
    },
  },
  "rubber-high-grip": {
    id: "rubber-high-grip",
    name: "High-Grip Rubber Surface",
    description:
      "High-traction textured elastomer matting providing mechanical interlock and high friction.",
    staticFrictionCoeff: 1.15,
    kineticFrictionCoeff: 0.95,
    provenance: {
      source: "assumed-simulation-preset",
      verified: false,
      notes:
        "Estimated nominal values for rubber tires contacting high-traction elastomer or composite matting.",
    },
  },
  "low-grip": {
    id: "low-grip",
    name: "Low-Grip Surface (Ice / Spill)",
    description:
      "Low-traction surface simulating ice, polished wet tile, or arena lubricant/coolant spills.",
    staticFrictionCoeff: 0.2,
    kineticFrictionCoeff: 0.15,
    provenance: {
      source: "assumed-simulation-preset",
      verified: false,
      notes:
        "Estimated nominal hazard values simulating low-traction slippery conditions (ice, polished plastic, or spill).",
    },
  },
} as const satisfies Record<string, GroundSurface>;

/**
 * Read-only array of all standard ground surface presets.
 */
export const GROUND_SURFACE_PRESETS: readonly GroundSurface[] = Object.freeze(
  Object.values(SURFACE_PRESETS)
);

/**
 * Standard default arena surface used throughout Robot Wars simulation.
 * Preserves the existing nominal rubber-on-steel baseline (μs = 0.85).
 */
export const DEFAULT_GROUND_SURFACE: GroundSurface = SURFACE_PRESETS.steel;

/**
 * Reference baseline static friction coefficient corresponding to DEFAULT_GROUND_SURFACE.
 */
export const REFERENCE_BASELINE_FRICTION_COEFF =
  DEFAULT_GROUND_SURFACE.staticFrictionCoeff;

/**
 * Reference baseline kinetic friction coefficient corresponding to DEFAULT_GROUND_SURFACE.
 */
export const REFERENCE_BASELINE_KINETIC_FRICTION_COEFF =
  DEFAULT_GROUND_SURFACE.kineticFrictionCoeff;

/**
 * Pure validator for a GroundSurface definition.
 */
export function validateGroundSurface(
  surface: unknown
): GroundSurfaceValidationResult {
  const errors: string[] = [];

  if (!surface || typeof surface !== "object") {
    return {
      isValid: false,
      errors: ["Surface definition must be a non-null object."],
    };
  }

  const s = surface as Partial<GroundSurface>;

  // 1. ID validation
  if (typeof s.id !== "string" || s.id.trim().length === 0) {
    errors.push("Surface 'id' must be a non-empty string.");
  }

  // 2. Name validation
  if (typeof s.name !== "string" || s.name.trim().length === 0) {
    errors.push("Surface 'name' must be a non-empty string.");
  }

  // 3. Description validation
  if (typeof s.description !== "string") {
    errors.push("Surface 'description' must be a string.");
  }

  // 4. Static friction validation
  if (
    typeof s.staticFrictionCoeff !== "number" ||
    !Number.isFinite(s.staticFrictionCoeff)
  ) {
    errors.push("Surface 'staticFrictionCoeff' (μs) must be a finite number.");
  } else if (s.staticFrictionCoeff < 0) {
    errors.push(
      `Surface 'staticFrictionCoeff' (μs) cannot be negative, received: ${s.staticFrictionCoeff}.`
    );
  }

  // 5. Kinetic friction validation
  if (
    typeof s.kineticFrictionCoeff !== "number" ||
    !Number.isFinite(s.kineticFrictionCoeff)
  ) {
    errors.push("Surface 'kineticFrictionCoeff' (μk) must be a finite number.");
  } else if (s.kineticFrictionCoeff < 0) {
    errors.push(
      `Surface 'kineticFrictionCoeff' (μk) cannot be negative, received: ${s.kineticFrictionCoeff}.`
    );
  }

  // 6. Physical relationship: μk <= μs
  if (
    typeof s.staticFrictionCoeff === "number" &&
    Number.isFinite(s.staticFrictionCoeff) &&
    typeof s.kineticFrictionCoeff === "number" &&
    Number.isFinite(s.kineticFrictionCoeff) &&
    s.kineticFrictionCoeff > s.staticFrictionCoeff + 1e-9
  ) {
    errors.push(
      `Kinetic friction coefficient (μk = ${s.kineticFrictionCoeff}) cannot exceed static friction coefficient (μs = ${s.staticFrictionCoeff}).`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Type guard asserting whether an unknown value is a valid GroundSurface.
 */
export function isGroundSurface(value: unknown): value is GroundSurface {
  return validateGroundSurface(value).isValid;
}

/**
 * Asserts that a value is a valid GroundSurface, throwing an Error if invalid.
 */
export function assertValidGroundSurface(
  surface: unknown
): asserts surface is GroundSurface {
  const result = validateGroundSurface(surface);
  if (!result.isValid) {
    throw new Error(`Invalid GroundSurface: ${result.errors.join("; ")}`);
  }
}

/**
 * Looks up a preset ground surface by ID.
 */
export function getGroundSurfacePreset(id: string): GroundSurface | undefined {
  if (!id || typeof id !== "string") return undefined;
  return (SURFACE_PRESETS as Record<string, GroundSurface>)[id];
}

/**
 * Pure resolver that accepts either a GroundSurface instance, a preset ID string,
 * or undefined, and returns a validated GroundSurface (falling back to DEFAULT_GROUND_SURFACE).
 */
export function resolveGroundSurface(
  surfaceOrId?: GroundSurface | string
): GroundSurface {
  if (!surfaceOrId) {
    return DEFAULT_GROUND_SURFACE;
  }
  if (typeof surfaceOrId === "string") {
    const preset = getGroundSurfacePreset(surfaceOrId);
    if (!preset) {
      throw new Error(
        `Unknown ground surface preset ID: "${surfaceOrId}". Available presets: ${Object.keys(
          SURFACE_PRESETS
        ).join(", ")}`
      );
    }
    return preset;
  }
  assertValidGroundSurface(surfaceOrId);
  return surfaceOrId;
}

/**
 * Resolves the effective static friction coefficient between a wheel and a ground surface.
 *
 * Compatibility & Physics Contract:
 * - Wheel engineering specifications define staticFrictionCoeff against the standard arena floor (steel, μs = 0.85).
 * - When driving on DEFAULT_GROUND_SURFACE, the returned value strictly equals wheel.staticFrictionCoeff (or 0.85 if unspecified).
 * - When driving on a non-default surface, wheel friction scales proportionally with the surface's friction relative to baseline:
 *     μ_effective = μ_wheel * (μ_surface / μ_baseline)
 * - If wheel friction is unspecified, returns surface.staticFrictionCoeff directly.
 * - Always non-negative and finite.
 */
export function resolveEffectiveStaticFriction(
  wheelStaticFrictionCoeff?: number,
  surface: GroundSurface = DEFAULT_GROUND_SURFACE
): number {
  const surfaceMu =
    surface?.staticFrictionCoeff ?? REFERENCE_BASELINE_FRICTION_COEFF;
  if (!Number.isFinite(surfaceMu) || surfaceMu <= 0) {
    return 0;
  }

  if (wheelStaticFrictionCoeff === undefined) {
    return surfaceMu;
  }

  if (
    !Number.isFinite(wheelStaticFrictionCoeff) ||
    wheelStaticFrictionCoeff <= 0
  ) {
    return 0;
  }

  // If on the reference baseline surface, preserve exact wheel friction without floating point scale distortion
  if (Math.abs(surfaceMu - REFERENCE_BASELINE_FRICTION_COEFF) < 1e-9) {
    return wheelStaticFrictionCoeff;
  }

  // Scale proportionally for non-baseline surfaces
  return (
    wheelStaticFrictionCoeff * (surfaceMu / REFERENCE_BASELINE_FRICTION_COEFF)
  );
}

/**
 * Resolves the effective kinetic friction coefficient between a wheel and a ground surface.
 */
export function resolveEffectiveKineticFriction(
  wheelKineticFrictionCoeff?: number,
  surface: GroundSurface = DEFAULT_GROUND_SURFACE
): number {
  const surfaceMu =
    surface?.kineticFrictionCoeff ?? REFERENCE_BASELINE_KINETIC_FRICTION_COEFF;
  if (!Number.isFinite(surfaceMu) || surfaceMu <= 0) {
    return 0;
  }

  if (wheelKineticFrictionCoeff === undefined) {
    return surfaceMu;
  }

  if (
    !Number.isFinite(wheelKineticFrictionCoeff) ||
    wheelKineticFrictionCoeff <= 0
  ) {
    return 0;
  }

  if (
    Math.abs(surfaceMu - REFERENCE_BASELINE_KINETIC_FRICTION_COEFF) < 1e-9
  ) {
    return wheelKineticFrictionCoeff;
  }

  return (
    wheelKineticFrictionCoeff *
    (surfaceMu / REFERENCE_BASELINE_KINETIC_FRICTION_COEFF)
  );
}

/**
 * Resolves both effective static and kinetic friction coefficients for a wheel-surface contact pair.
 */
export function resolveEffectiveFriction(
  wheelFriction?:
    | number
    | {
        readonly staticFrictionCoeff?: number;
        readonly dynamicFrictionCoeff?: number;
      },
  surface: GroundSurface = DEFAULT_GROUND_SURFACE
): EffectiveFrictionResult {
  const staticCoeff =
    typeof wheelFriction === "number"
      ? wheelFriction
      : wheelFriction?.staticFrictionCoeff;

  const kineticCoeff =
    typeof wheelFriction === "object" && wheelFriction !== null
      ? wheelFriction.dynamicFrictionCoeff
      : undefined;

  const effectiveStatic = resolveEffectiveStaticFriction(staticCoeff, surface);
  let effectiveKinetic = resolveEffectiveKineticFriction(kineticCoeff, surface);

  // Guarantee physical constraint: μk <= μs
  if (effectiveKinetic > effectiveStatic) {
    effectiveKinetic = effectiveStatic;
  }

  return {
    staticFrictionCoeff: effectiveStatic,
    kineticFrictionCoeff: effectiveKinetic,
  };
}
