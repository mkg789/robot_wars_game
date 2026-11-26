/**
 * Pure Arena Geometry & Spatial Surface Zones Model for Robot Wars.
 *
 * Provides:
 * - Deterministic geometric representation of arena boundaries, perimeter walls, and barriers in X-Z.
 * - Spatial surface zone querying with strict priority-based overlap precedence and stable tie-breaking.
 * - Comprehensive validators, coordinate consistency checks, and factory helpers.
 *
 * Coordinate Conventions:
 * - +X = front baseline (longitudinal front)
 * - -X = rear baseline (longitudinal rear)
 * - +Y = vertical height (upward)
 * - +Z = left baseline (lateral left)
 * - -Z = right baseline (lateral right)
 *
 * NOTE: Pure geometry and data contracts only. Completely decoupled from physics solvers,
 * collision response, React, Three.js, DOM, and UI rendering.
 */

import type {
  ArenaBarrier,
  ArenaBoundaryConfig,
  ArenaBounds2D,
  ArenaConfig,
  ArenaDimensions,
  ArenaSurfaceZone,
  ArenaValidationResult,
  BarrierValidationResult,
  RectangularArenaBarrier,
  RectangularSurfaceZone,
  SurfaceZoneValidationResult,
} from "../types/arena.types";
import type { GroundSurface } from "../types/surface.types";
import {
  DEFAULT_GROUND_SURFACE,
  resolveGroundSurface,
  SURFACE_PRESETS,
  validateGroundSurface,
} from "./surfaceModel";

/**
 * Pure check to determine if a 2D point (x, z) lies within an axis-aligned bounding box.
 * Uses closed / inclusive intervals: min <= value <= max.
 */
export function isPointInBounds(
  point: { readonly x: number; readonly z: number },
  bounds: ArenaBounds2D
): boolean {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.z) ||
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minZ) ||
    !Number.isFinite(bounds.maxZ)
  ) {
    return false;
  }
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ
  );
}

/**
 * Pure check to determine if coordinates (x, z) lie within an axis-aligned bounding box.
 */
export function isPointInRectangle(
  x: number,
  z: number,
  bounds: ArenaBounds2D
): boolean {
  return isPointInBounds({ x, z }, bounds);
}

/**
 * Checks if a point lies within the outer perimeter boundaries of an arena.
 */
export function isPointInsideArenaBounds(
  point: { readonly x: number; readonly z: number },
  arena: ArenaConfig
): boolean {
  return isPointInBounds(point, arena.bounds);
}

/**
 * Computes the axis-aligned 2D bounding box enclosing an arena barrier in the X-Z plane,
 * accounting for optional barrier yaw rotation.
 */
export function getBarrierBounds(barrier: ArenaBarrier): ArenaBounds2D {
  const halfBx = barrier.sizeX / 2;
  const halfBz = barrier.sizeZ / 2;
  const rot = barrier.rotationRadians ?? 0;
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));
  const halfX = halfBx * cos + halfBz * sin;
  const halfZ = halfBx * sin + halfBz * cos;
  return {
    minX: barrier.position.x - halfX,
    maxX: barrier.position.x + halfX,
    minZ: barrier.position.z - halfZ,
    maxZ: barrier.position.z + halfZ,
  };
}

/**
 * Validates a single arena barrier definition.
 */
export function validateArenaBarrier(
  barrier: unknown
): BarrierValidationResult {
  const errors: string[] = [];

  if (!barrier || typeof barrier !== "object") {
    return {
      isValid: false,
      errors: ["Barrier definition must be a non-null object."],
    };
  }

  const b = barrier as Partial<RectangularArenaBarrier>;

  if (typeof b.id !== "string" || b.id.trim().length === 0) {
    errors.push("Barrier 'id' must be a non-empty string.");
  }

  if (b.geometryType !== "rectangle") {
    errors.push(
      `Barrier 'geometryType' must be 'rectangle', received: "${b.geometryType}".`
    );
  }

  if (
    !b.position ||
    typeof b.position !== "object" ||
    !Number.isFinite(b.position.x) ||
    !Number.isFinite(b.position.z)
  ) {
    errors.push("Barrier 'position' must contain finite 'x' and 'z' coordinates.");
  }

  if (typeof b.sizeX !== "number" || !Number.isFinite(b.sizeX) || b.sizeX <= 0) {
    errors.push(
      `Barrier 'sizeX' (longitudinal extent) must be a positive finite number, received: ${b.sizeX}.`
    );
  }

  if (typeof b.sizeZ !== "number" || !Number.isFinite(b.sizeZ) || b.sizeZ <= 0) {
    errors.push(
      `Barrier 'sizeZ' (lateral extent) must be a positive finite number, received: ${b.sizeZ}.`
    );
  }

  if (
    b.heightM !== undefined &&
    (typeof b.heightM !== "number" || !Number.isFinite(b.heightM) || b.heightM <= 0)
  ) {
    errors.push(
      `Barrier 'heightM' must be a positive finite number when specified, received: ${b.heightM}.`
    );
  }

  if (
    b.rotationRadians !== undefined &&
    (typeof b.rotationRadians !== "number" || !Number.isFinite(b.rotationRadians))
  ) {
    errors.push(
      `Barrier 'rotationRadians' must be a finite number when specified, received: ${b.rotationRadians}.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Type guard for an ArenaBarrier.
 */
export function isArenaBarrier(value: unknown): value is ArenaBarrier {
  return validateArenaBarrier(value).isValid;
}

/**
 * Asserts that a value is a valid ArenaBarrier, throwing an Error if invalid.
 */
export function assertValidArenaBarrier(
  barrier: unknown
): asserts barrier is ArenaBarrier {
  const result = validateArenaBarrier(barrier);
  if (!result.isValid) {
    throw new Error(`Invalid ArenaBarrier: ${result.errors.join("; ")}`);
  }
}

/**
 * Validates a single spatial surface zone definition.
 */
export function validateArenaSurfaceZone(
  zone: unknown
): SurfaceZoneValidationResult {
  const errors: string[] = [];

  if (!zone || typeof zone !== "object") {
    return {
      isValid: false,
      errors: ["Surface zone definition must be a non-null object."],
    };
  }

  const z = zone as Partial<RectangularSurfaceZone>;

  if (typeof z.id !== "string" || z.id.trim().length === 0) {
    errors.push("Surface zone 'id' must be a non-empty string.");
  }

  if (z.shape !== "rectangle") {
    errors.push(
      `Surface zone 'shape' must be 'rectangle', received: "${z.shape}".`
    );
  }

  if (!z.bounds || typeof z.bounds !== "object") {
    errors.push("Surface zone 'bounds' must be a non-null object.");
  } else {
    const { minX, maxX, minZ, maxZ } = z.bounds;
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(minZ) ||
      !Number.isFinite(maxZ)
    ) {
      errors.push("Surface zone 'bounds' coordinates must all be finite numbers.");
    } else {
      if (minX > maxX) {
        errors.push(
          `Surface zone 'bounds' minX (${minX}) cannot exceed maxX (${maxX}).`
        );
      }
      if (minZ > maxZ) {
        errors.push(
          `Surface zone 'bounds' minZ (${minZ}) cannot exceed maxZ (${maxZ}).`
        );
      }
    }
  }

  // Surface reference validation
  if (typeof z.surface === "string") {
    if (!z.surface || !SURFACE_PRESETS[z.surface as keyof typeof SURFACE_PRESETS]) {
      errors.push(
        `Surface zone references unknown preset ID "${z.surface}". Available presets: ${Object.keys(
          SURFACE_PRESETS
        ).join(", ")}.`
      );
    }
  } else if (z.surface && typeof z.surface === "object") {
    const surfaceValidation = validateGroundSurface(z.surface);
    if (!surfaceValidation.isValid) {
      errors.push(
        `Surface zone has invalid GroundSurface: ${surfaceValidation.errors.join(
          "; "
        )}`
      );
    }
  } else {
    errors.push(
      "Surface zone 'surface' must be a GroundSurface object or a known preset ID string."
    );
  }

  if (z.priority !== undefined && !Number.isFinite(z.priority)) {
    errors.push("Surface zone 'priority' must be a finite number when specified.");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Type guard for an ArenaSurfaceZone.
 */
export function isArenaSurfaceZone(value: unknown): value is ArenaSurfaceZone {
  return validateArenaSurfaceZone(value).isValid;
}

/**
 * Asserts that a value is a valid ArenaSurfaceZone, throwing an Error if invalid.
 */
export function assertValidArenaSurfaceZone(
  zone: unknown
): asserts zone is ArenaSurfaceZone {
  const result = validateArenaSurfaceZone(zone);
  if (!result.isValid) {
    throw new Error(`Invalid ArenaSurfaceZone: ${result.errors.join("; ")}`);
  }
}

/**
 * Validates a complete arena configuration.
 */
export function validateArena(arena: unknown): ArenaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!arena || typeof arena !== "object") {
    return {
      isValid: false,
      errors: ["Arena configuration must be a non-null object."],
      warnings: [],
    };
  }

  const a = arena as Partial<ArenaConfig>;

  // 1. Identity validation
  if (typeof a.id !== "string" || a.id.trim().length === 0) {
    errors.push("Arena 'id' must be a non-empty string.");
  }
  if (typeof a.name !== "string" || a.name.trim().length === 0) {
    errors.push("Arena 'name' must be a non-empty string.");
  }

  // 2. Dimensions validation
  let hasValidDimensions = false;
  if (!a.dimensions || typeof a.dimensions !== "object") {
    errors.push("Arena 'dimensions' must be a non-null object.");
  } else {
    const { lengthM, widthM, heightM } = a.dimensions;
    if (typeof lengthM !== "number" || !Number.isFinite(lengthM) || lengthM <= 0) {
      errors.push(
        `Arena dimensions 'lengthM' must be a positive finite number, received: ${lengthM}.`
      );
    }
    if (typeof widthM !== "number" || !Number.isFinite(widthM) || widthM <= 0) {
      errors.push(
        `Arena dimensions 'widthM' must be a positive finite number, received: ${widthM}.`
      );
    }
    if (
      heightM !== undefined &&
      (typeof heightM !== "number" || !Number.isFinite(heightM) || heightM <= 0)
    ) {
      errors.push(
        `Arena dimensions 'heightM' must be a positive finite number when specified, received: ${heightM}.`
      );
    }
    hasValidDimensions =
      typeof lengthM === "number" &&
      Number.isFinite(lengthM) &&
      lengthM > 0 &&
      typeof widthM === "number" &&
      Number.isFinite(widthM) &&
      widthM > 0;
  }

  // 3. Bounds validation & dimension consistency
  if (!a.bounds || typeof a.bounds !== "object") {
    errors.push("Arena 'bounds' must be a non-null object.");
  } else {
    const { minX, maxX, minZ, maxZ } = a.bounds;
    const isFiniteCoords =
      Number.isFinite(minX) &&
      Number.isFinite(maxX) &&
      Number.isFinite(minZ) &&
      Number.isFinite(maxZ);

    if (!isFiniteCoords) {
      errors.push("Arena 'bounds' coordinates must all be finite numbers.");
    } else {
      if (minX >= maxX) {
        errors.push(`Arena bounds 'minX' (${minX}) must be strictly less than 'maxX' (${maxX}).`);
      }
      if (minZ >= maxZ) {
        errors.push(`Arena bounds 'minZ' (${minZ}) must be strictly less than 'maxZ' (${maxZ}).`);
      }

      // Check dimensional consistency if both dimensions and bounds are finite
      if (hasValidDimensions && minX < maxX && minZ < maxZ) {
        const spanX = maxX - minX;
        const spanZ = maxZ - minZ;
        const deltaX = Math.abs(spanX - a.dimensions!.lengthM);
        const deltaZ = Math.abs(spanZ - a.dimensions!.widthM);

        if (deltaX > 1e-4) {
          errors.push(
            `Inconsistent X dimensions: bounds span ${spanX.toFixed(
              4
            )} m (maxX ${maxX} - minX ${minX}) does not match dimensions.lengthM ${a.dimensions!.lengthM.toFixed(
              4
            )} m.`
          );
        }
        if (deltaZ > 1e-4) {
          errors.push(
            `Inconsistent Z dimensions: bounds span ${spanZ.toFixed(
              4
            )} m (maxZ ${maxZ} - minZ ${minZ}) does not match dimensions.widthM ${a.dimensions!.widthM.toFixed(
              4
            )} m.`
          );
        }
      }
    }
  }

  // 4. Boundary & Barriers validation
  const barrierIds = new Set<string>();

  if (!a.boundary || typeof a.boundary !== "object") {
    errors.push("Arena 'boundary' configuration must be an object.");
  } else {
    if (
      a.boundary.wallThicknessM !== undefined &&
      (typeof a.boundary.wallThicknessM !== "number" ||
        !Number.isFinite(a.boundary.wallThicknessM) ||
        a.boundary.wallThicknessM <= 0)
    ) {
      errors.push("Arena boundary 'wallThicknessM' must be a positive finite number.");
    }
    if (
      a.boundary.wallHeightM !== undefined &&
      (typeof a.boundary.wallHeightM !== "number" ||
        !Number.isFinite(a.boundary.wallHeightM) ||
        a.boundary.wallHeightM <= 0)
    ) {
      errors.push("Arena boundary 'wallHeightM' must be a positive finite number.");
    }

    if (Array.isArray(a.boundary.perimeterWalls)) {
      for (const wall of a.boundary.perimeterWalls) {
        const wallRes = validateArenaBarrier(wall);
        if (!wallRes.isValid) {
          errors.push(`Invalid perimeter wall barrier: ${wallRes.errors.join("; ")}`);
        } else {
          if (barrierIds.has(wall.id)) {
            errors.push(`Duplicate barrier ID "${wall.id}" detected in perimeter walls.`);
          }
          barrierIds.add(wall.id);
        }
      }
    } else {
      errors.push("Arena boundary 'perimeterWalls' must be an array.");
    }
  }

  if (Array.isArray(a.barriers)) {
    for (const barrier of a.barriers) {
      const bRes = validateArenaBarrier(barrier);
      if (!bRes.isValid) {
        errors.push(`Invalid interior barrier: ${bRes.errors.join("; ")}`);
      } else {
        if (barrierIds.has(barrier.id)) {
          errors.push(`Duplicate barrier ID "${barrier.id}" detected in arena barriers.`);
        }
        barrierIds.add(barrier.id);
      }
    }
  } else {
    errors.push("Arena 'barriers' must be an array.");
  }

  // 5. Surface Zones validation
  const zoneIds = new Set<string>();

  if (Array.isArray(a.surfaceZones)) {
    for (const zone of a.surfaceZones) {
      const zRes = validateArenaSurfaceZone(zone);
      if (!zRes.isValid) {
        errors.push(`Invalid surface zone: ${zRes.errors.join("; ")}`);
      } else {
        if (zoneIds.has(zone.id)) {
          errors.push(`Duplicate surface zone ID "${zone.id}" detected.`);
        }
        zoneIds.add(zone.id);

        // Warning if zone extends outside arena bounds
        if (a.bounds) {
          if (
            zone.bounds.minX < a.bounds.minX ||
            zone.bounds.maxX > a.bounds.maxX ||
            zone.bounds.minZ < a.bounds.minZ ||
            zone.bounds.maxZ > a.bounds.maxZ
          ) {
            warnings.push(
              `Surface zone "${zone.id}" extends beyond arena bounds.`
            );
          }
        }
      }
    }
  } else {
    errors.push("Arena 'surfaceZones' must be an array.");
  }

  // 6. Fallback Surface validation
  if (a.fallbackSurface !== undefined) {
    if (typeof a.fallbackSurface === "string") {
      if (!SURFACE_PRESETS[a.fallbackSurface as keyof typeof SURFACE_PRESETS]) {
        errors.push(
          `Arena 'fallbackSurface' references unknown preset ID "${a.fallbackSurface}".`
        );
      }
    } else if (typeof a.fallbackSurface === "object" && a.fallbackSurface !== null) {
      const sRes = validateGroundSurface(a.fallbackSurface);
      if (!sRes.isValid) {
        errors.push(
          `Arena 'fallbackSurface' is invalid GroundSurface: ${sRes.errors.join("; ")}`
        );
      }
    } else {
      errors.push("Arena 'fallbackSurface' must be a GroundSurface or preset ID string.");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Type guard for an ArenaConfig.
 */
export function isArenaConfig(value: unknown): value is ArenaConfig {
  return validateArena(value).isValid;
}

/**
 * Asserts that a value is a valid ArenaConfig, throwing an Error if invalid.
 */
export function assertValidArena(arena: unknown): asserts arena is ArenaConfig {
  const result = validateArena(arena);
  if (!result.isValid) {
    throw new Error(`Invalid ArenaConfig: ${result.errors.join("; ")}`);
  }
}

/**
 * Queries all spatial surface zones covering a given 2D point (x, z),
 * returned in order of priority (highest first) with deterministic tie-breaking.
 *
 * Deterministic Precedence Rules:
 * 1. Primary Sort: Descending order of `zone.priority ?? 0` (highest priority wins).
 * 2. Secondary Sort (Tie-Breaker): Ascending lexicographical order of `zone.id`.
 *    Guarantees resolution never depends on array insertion order or array mutation.
 */
export function findActiveSurfaceZonesAtPoint(
  arena: ArenaConfig,
  x: number,
  z: number
): readonly ArenaSurfaceZone[] {
  if (!arena || !Array.isArray(arena.surfaceZones) || arena.surfaceZones.length === 0) {
    return [];
  }

  const matching = arena.surfaceZones.filter((zone) =>
    isPointInBounds({ x, z }, zone.bounds)
  );

  if (matching.length <= 1) {
    return matching;
  }

  return [...matching].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;

    // 1. Higher priority takes precedence
    if (priorityB !== priorityA) {
      return priorityB - priorityA;
    }

    // 2. Stable deterministic tie-breaker: alphabetical by ID
    return a.id.localeCompare(b.id);
  });
}

/**
 * Resolves the effective ground surface at an arbitrary (x, z) arena coordinate.
 *
 * Resolution Contract:
 * 1. Checks all spatial surface zones in the arena containing (x, z).
 * 2. If one or more zones cover (x, z), the winning zone (highest priority, stable ID tie-breaker) is selected.
 * 3. The winning zone's surface reference is resolved via `resolveGroundSurface`.
 * 4. If no surface zones cover (x, z), falls back to `arena.fallbackSurface`.
 * 5. If `arena.fallbackSurface` is omitted, defaults to `DEFAULT_GROUND_SURFACE` (standard steel arena floor).
 */
export function resolveSurfaceAtPoint(
  arena: ArenaConfig,
  x: number,
  z: number
): GroundSurface {
  const activeZones = findActiveSurfaceZonesAtPoint(arena, x, z);

  if (activeZones.length > 0) {
    const winningZone = activeZones[0];
    return resolveGroundSurface(winningZone.surface);
  }

  // Fallback to arena surface or global default
  return resolveGroundSurface(arena.fallbackSurface ?? DEFAULT_GROUND_SURFACE);
}

/**
 * Generates four perimeter wall barriers bounding a rectangular arena footprint.
 *
 * Positions the walls immediately adjacent to the arena bounds:
 * - North Wall (+X): Located at +X perimeter edge, spans full lateral width (Z).
 * - South Wall (-X): Located at -X perimeter edge, spans full lateral width (Z).
 * - West Wall (+Z): Located at +Z perimeter edge, spans longitudinal length (X).
 * - East Wall (-Z): Located at -Z perimeter edge, spans longitudinal length (X).
 */
export function generatePerimeterWalls(
  bounds: ArenaBounds2D,
  options?: {
    readonly wallThicknessM?: number;
    readonly wallHeightM?: number;
  }
): readonly ArenaBarrier[] {
  const thickness = options?.wallThicknessM ?? 0.2;
  const height = options?.wallHeightM ?? 1.2;

  const lengthX = bounds.maxX - bounds.minX;
  const widthZ = bounds.maxZ - bounds.minZ;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  const halfThickness = thickness / 2;

  return [
    {
      id: "perimeter-wall-north-x-pos",
      name: "North Perimeter Wall (+X)",
      description: "Front longitudinal perimeter wall.",
      isPerimeter: true,
      geometryType: "rectangle",
      position: {
        x: bounds.maxX + halfThickness,
        z: centerZ,
      },
      sizeX: thickness,
      sizeZ: widthZ + 2 * thickness,
      heightM: height,
      rotationRadians: 0,
    },
    {
      id: "perimeter-wall-south-x-neg",
      name: "South Perimeter Wall (-X)",
      description: "Rear longitudinal perimeter wall.",
      isPerimeter: true,
      geometryType: "rectangle",
      position: {
        x: bounds.minX - halfThickness,
        z: centerZ,
      },
      sizeX: thickness,
      sizeZ: widthZ + 2 * thickness,
      heightM: height,
      rotationRadians: 0,
    },
    {
      id: "perimeter-wall-west-z-pos",
      name: "West Perimeter Wall (+Z)",
      description: "Left lateral perimeter wall.",
      isPerimeter: true,
      geometryType: "rectangle",
      position: {
        x: centerX,
        z: bounds.maxZ + halfThickness,
      },
      sizeX: lengthX,
      sizeZ: thickness,
      heightM: height,
      rotationRadians: 0,
    },
    {
      id: "perimeter-wall-east-z-neg",
      name: "East Perimeter Wall (-Z)",
      description: "Right lateral perimeter wall.",
      isPerimeter: true,
      geometryType: "rectangle",
      position: {
        x: centerX,
        z: bounds.minZ - halfThickness,
      },
      sizeX: lengthX,
      sizeZ: thickness,
      heightM: height,
      rotationRadians: 0,
    },
  ];
}

/**
 * Options for constructing a rectangular surface zone.
 */
export interface CreateRectangularSurfaceZoneOptions {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly bounds?: ArenaBounds2D;
  readonly center?: { readonly x: number; readonly z: number };
  readonly sizeX?: number;
  readonly sizeZ?: number;
  readonly surface: GroundSurface | string;
  readonly priority?: number;
}

/**
 * Factory helper for creating a validated rectangular surface zone.
 */
export function createRectangularSurfaceZone(
  options: CreateRectangularSurfaceZoneOptions
): ArenaSurfaceZone {
  let bounds: ArenaBounds2D;

  if (options.bounds) {
    bounds = options.bounds;
  } else if (
    options.center &&
    options.sizeX !== undefined &&
    options.sizeZ !== undefined
  ) {
    const halfX = options.sizeX / 2;
    const halfZ = options.sizeZ / 2;
    bounds = {
      minX: options.center.x - halfX,
      maxX: options.center.x + halfX,
      minZ: options.center.z - halfZ,
      maxZ: options.center.z + halfZ,
    };
  } else {
    throw new Error(
      "createRectangularSurfaceZone requires either explicit 'bounds' or 'center' with 'sizeX' and 'sizeZ'."
    );
  }

  const zone: ArenaSurfaceZone = {
    id: options.id,
    name: options.name,
    description: options.description,
    shape: "rectangle",
    bounds,
    surface: options.surface,
    priority: options.priority ?? 0,
  };

  assertValidArenaSurfaceZone(zone);
  return zone;
}

/**
 * Options for constructing a rectangular arena.
 */
export interface CreateRectangularArenaOptions {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly lengthM: number;
  readonly widthM: number;
  readonly heightM?: number;
  readonly center?: { readonly x: number; readonly z: number };
  readonly bounds?: ArenaBounds2D;
  readonly wallThicknessM?: number;
  readonly wallHeightM?: number;
  readonly barriers?: readonly ArenaBarrier[];
  readonly surfaceZones?: readonly ArenaSurfaceZone[];
  readonly fallbackSurface?: GroundSurface | string;
}

/**
 * Factory helper for creating a validated rectangular arena configuration.
 */
export function createRectangularArena(
  options: CreateRectangularArenaOptions
): ArenaConfig {
  let bounds: ArenaBounds2D;

  if (options.bounds) {
    bounds = options.bounds;
  } else {
    const cx = options.center?.x ?? 0;
    const cz = options.center?.z ?? 0;
    const halfX = options.lengthM / 2;
    const halfZ = options.widthM / 2;
    bounds = {
      minX: cx - halfX,
      maxX: cx + halfX,
      minZ: cz - halfZ,
      maxZ: cz + halfZ,
    };
  }

  const dimensions: ArenaDimensions = {
    lengthM: options.lengthM,
    widthM: options.widthM,
    heightM: options.heightM,
  };

  const perimeterWalls = generatePerimeterWalls(bounds, {
    wallThicknessM: options.wallThicknessM,
    wallHeightM: options.wallHeightM,
  });

  const boundary: ArenaBoundaryConfig = {
    wallThicknessM: options.wallThicknessM ?? 0.2,
    wallHeightM: options.wallHeightM ?? 1.2,
    perimeterWalls,
  };

  const arena: ArenaConfig = {
    id: options.id,
    name: options.name,
    description: options.description,
    dimensions,
    bounds,
    boundary,
    barriers: options.barriers ?? [],
    surfaceZones: options.surfaceZones ?? [],
    fallbackSurface: options.fallbackSurface ?? DEFAULT_GROUND_SURFACE,
  };

  assertValidArena(arena);
  return arena;
}

/**
 * Canonical Standard Robot Wars Arena Preset.
 *
 * Specifications:
 * - Footprint: 12.0 m (length along X) x 12.0 m (width along Z).
 * - Centered at world origin (0, 0), spans X in [-6, +6], Z in [-6, +6].
 * - Floor: Standard clean dry steel arena floor (DEFAULT_GROUND_SURFACE, μs = 0.85).
 * - Perimeter: 0.2 m thick steel boundary walls, 1.2 m height.
 */
export const STANDARD_ROBOT_WARS_ARENA: ArenaConfig = Object.freeze(
  createRectangularArena({
    id: "standard-robot-wars-12x12",
    name: "Standard Robot Wars Arena (12m x 12m)",
    description:
      "Official regulation 12m x 12m square battle arena with smooth steel floor plate and perimeter hazard walls.",
    lengthM: 12.0,
    widthM: 12.0,
    heightM: 4.0,
    wallThicknessM: 0.2,
    wallHeightM: 1.2,
    fallbackSurface: DEFAULT_GROUND_SURFACE,
  })
);
