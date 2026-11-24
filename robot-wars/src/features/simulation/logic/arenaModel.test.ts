import { describe, expect, it } from "vitest";
import type {
  ArenaBarrier,
  ArenaBounds2D,
  ArenaConfig,
} from "../types/arena.types";
import {
  DEFAULT_GROUND_SURFACE,
  SURFACE_PRESETS,
} from "./surfaceModel";
import {
  assertValidArena,
  assertValidArenaBarrier,
  assertValidArenaSurfaceZone,
  createRectangularArena,
  createRectangularSurfaceZone,
  findActiveSurfaceZonesAtPoint,
  generatePerimeterWalls,
  getBarrierBounds,
  isArenaBarrier,
  isArenaConfig,
  isArenaSurfaceZone,
  isPointInBounds,
  isPointInRectangle,
  isPointInsideArenaBounds,
  resolveSurfaceAtPoint,
  STANDARD_ROBOT_WARS_ARENA,
  validateArena,
  validateArenaBarrier,
  validateArenaSurfaceZone,
} from "./arenaModel";

describe("Phase 4.1.2: Arena Geometry & Spatial Surface Zones", () => {
  describe("1. Geometry Checks & Point-in-Rectangle Utilities", () => {
    const testBounds: ArenaBounds2D = {
      minX: -5,
      maxX: 5,
      minZ: -3,
      maxZ: 3,
    };

    it("correctly determines points strictly inside rectangular bounds", () => {
      expect(isPointInBounds({ x: 0, z: 0 }, testBounds)).toBe(true);
      expect(isPointInBounds({ x: 2, z: -1 }, testBounds)).toBe(true);
      expect(isPointInRectangle(-4, 2, testBounds)).toBe(true);
    });

    it("correctly identifies points strictly outside rectangular bounds", () => {
      expect(isPointInBounds({ x: 5.1, z: 0 }, testBounds)).toBe(false);
      expect(isPointInBounds({ x: -5.1, z: 0 }, testBounds)).toBe(false);
      expect(isPointInBounds({ x: 0, z: 3.1 }, testBounds)).toBe(false);
      expect(isPointInBounds({ x: 0, z: -3.1 }, testBounds)).toBe(false);
      expect(isPointInRectangle(10, 10, testBounds)).toBe(false);
    });

    it("treats boundary edges and corners as inclusive", () => {
      // Four corners
      expect(isPointInRectangle(-5, -3, testBounds)).toBe(true);
      expect(isPointInRectangle(-5, 3, testBounds)).toBe(true);
      expect(isPointInRectangle(5, -3, testBounds)).toBe(true);
      expect(isPointInRectangle(5, 3, testBounds)).toBe(true);

      // Four edge midpoints
      expect(isPointInRectangle(5, 0, testBounds)).toBe(true); // North (+X) edge
      expect(isPointInRectangle(-5, 0, testBounds)).toBe(true); // South (-X) edge
      expect(isPointInRectangle(0, 3, testBounds)).toBe(true); // West (+Z) edge
      expect(isPointInRectangle(0, -3, testBounds)).toBe(true); // East (-Z) edge
    });

    it("returns false for non-finite coordinates or bounds", () => {
      expect(isPointInBounds({ x: Number.NaN, z: 0 }, testBounds)).toBe(false);
      expect(
        isPointInBounds({ x: 0, z: Number.POSITIVE_INFINITY }, testBounds)
      ).toBe(false);
      expect(
        isPointInBounds(
          { x: 0, z: 0 },
          { minX: Number.NaN, maxX: 5, minZ: -3, maxZ: 3 }
        )
      ).toBe(false);
    });

    it("computes barrier AABB bounds correctly", () => {
      const barrier: ArenaBarrier = {
        id: "barrier-center-pillar",
        name: "Center Pillar",
        geometryType: "rectangle",
        position: { x: 2, z: -1 },
        sizeX: 1.0, // length along X
        sizeZ: 0.5, // width along Z
      };

      const bounds = getBarrierBounds(barrier);
      expect(bounds.minX).toBeCloseTo(1.5);
      expect(bounds.maxX).toBeCloseTo(2.5);
      expect(bounds.minZ).toBeCloseTo(-1.25);
      expect(bounds.maxZ).toBeCloseTo(-0.75);
    });
  });

  describe("2. Barrier Geometry Validation", () => {
    it("validates a compliant rectangular arena barrier", () => {
      const barrier: ArenaBarrier = {
        id: "b-1",
        name: "Steel Pylon",
        description: "Hard obstacle",
        isPerimeter: false,
        geometryType: "rectangle",
        position: { x: 0, z: 0 },
        sizeX: 1.2,
        sizeZ: 0.8,
        heightM: 1.5,
        rotationRadians: 0,
      };

      const res = validateArenaBarrier(barrier);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(isArenaBarrier(barrier)).toBe(true);
      expect(() => assertValidArenaBarrier(barrier)).not.toThrow();
    });

    it("rejects non-object, empty id, or wrong geometryType", () => {
      expect(validateArenaBarrier(null).isValid).toBe(false);
      expect(validateArenaBarrier({}).isValid).toBe(false);

      const emptyId = {
        id: "   ",
        geometryType: "rectangle",
        position: { x: 0, z: 0 },
        sizeX: 1,
        sizeZ: 1,
      };
      expect(validateArenaBarrier(emptyId).isValid).toBe(false);

      const badType = {
        id: "b-1",
        geometryType: "triangle",
        position: { x: 0, z: 0 },
        sizeX: 1,
        sizeZ: 1,
      };
      expect(validateArenaBarrier(badType).isValid).toBe(false);
    });

    it("rejects non-positive dimensions or non-finite position coordinates", () => {
      const zeroSize = {
        id: "b-1",
        geometryType: "rectangle",
        position: { x: 0, z: 0 },
        sizeX: 0,
        sizeZ: 1,
      };
      expect(validateArenaBarrier(zeroSize).isValid).toBe(false);

      const negSize = {
        id: "b-1",
        geometryType: "rectangle",
        position: { x: 0, z: 0 },
        sizeX: 1,
        sizeZ: -0.5,
      };
      expect(validateArenaBarrier(negSize).isValid).toBe(false);

      const nanPos = {
        id: "b-1",
        geometryType: "rectangle",
        position: { x: Number.NaN, z: 0 },
        sizeX: 1,
        sizeZ: 1,
      };
      expect(validateArenaBarrier(nanPos).isValid).toBe(false);

      const negHeight = {
        id: "b-1",
        geometryType: "rectangle",
        position: { x: 0, z: 0 },
        sizeX: 1,
        sizeZ: 1,
        heightM: -1,
      };
      expect(validateArenaBarrier(negHeight).isValid).toBe(false);
    });
  });

  describe("3. Spatial Surface Zone Validation", () => {
    it("validates a surface zone with preset surface string reference", () => {
      const zone = createRectangularSurfaceZone({
        id: "zone-ice-pit",
        name: "Hazard Zone",
        bounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
        surface: "low-grip",
        priority: 5,
      });

      const res = validateArenaSurfaceZone(zone);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(isArenaSurfaceZone(zone)).toBe(true);
      expect(() => assertValidArenaSurfaceZone(zone)).not.toThrow();
    });

    it("validates a surface zone with full GroundSurface object", () => {
      const zone = createRectangularSurfaceZone({
        id: "zone-rubber-start",
        name: "Starting Box",
        bounds: { minX: 3, maxX: 5, minZ: 3, maxZ: 5 },
        surface: SURFACE_PRESETS["rubber-high-grip"],
        priority: 2,
      });

      expect(validateArenaSurfaceZone(zone).isValid).toBe(true);
    });

    it("creates rectangular zone from center and dimensions", () => {
      const zone = createRectangularSurfaceZone({
        id: "zone-centered",
        center: { x: 1, z: 2 },
        sizeX: 4,
        sizeZ: 6,
        surface: "concrete",
      });

      expect(zone.bounds.minX).toBe(-1);
      expect(zone.bounds.maxX).toBe(3);
      expect(zone.bounds.minZ).toBe(-1);
      expect(zone.bounds.maxZ).toBe(5);
    });

    it("rejects surface zones with inverted bounds (minX > maxX or minZ > maxZ)", () => {
      const invertedX = {
        id: "zone-bad",
        shape: "rectangle",
        bounds: { minX: 5, maxX: 2, minZ: 0, maxZ: 2 },
        surface: "concrete",
      };
      expect(validateArenaSurfaceZone(invertedX).isValid).toBe(false);

      const invertedZ = {
        id: "zone-bad-z",
        shape: "rectangle",
        bounds: { minX: 0, maxX: 2, minZ: 5, maxZ: 2 },
        surface: "concrete",
      };
      expect(validateArenaSurfaceZone(invertedZ).isValid).toBe(false);
    });

    it("rejects surface zones referencing unknown surface preset IDs", () => {
      const unknownSurface = {
        id: "zone-bad-surface",
        shape: "rectangle",
        bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
        surface: "unknown-super-friction-preset",
      };
      const res = validateArenaSurfaceZone(unknownSurface);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain(
        'Surface zone references unknown preset ID "unknown-super-friction-preset"'
      );
    });
  });

  describe("4. Arena Configuration Validation & Dimensional Consistency", () => {
    it("validates a consistent rectangular arena configuration", () => {
      const arena = createRectangularArena({
        id: "arena-test-10x8",
        name: "Test Arena 10x8",
        lengthM: 10,
        widthM: 8,
        heightM: 3.5,
        center: { x: 0, z: 0 },
        wallThicknessM: 0.25,
        wallHeightM: 1.0,
      });

      const res = validateArena(arena);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(isArenaConfig(arena)).toBe(true);
      expect(() => assertValidArena(arena)).not.toThrow();

      // Check boundary bounds
      expect(arena.bounds.minX).toBe(-5);
      expect(arena.bounds.maxX).toBe(5);
      expect(arena.bounds.minZ).toBe(-4);
      expect(arena.bounds.maxZ).toBe(4);
      expect(arena.dimensions.lengthM).toBe(10);
      expect(arena.dimensions.widthM).toBe(8);

      // Check perimeter wall count
      expect(arena.boundary.perimeterWalls).toHaveLength(4);
    });

    it("rejects dimension/bound inconsistency (lengthM != maxX - minX)", () => {
      const mismatchedArena: ArenaConfig = {
        id: "mismatched",
        name: "Mismatched Bounds",
        dimensions: { lengthM: 10, widthM: 8 },
        bounds: { minX: -6, maxX: 6, minZ: -4, maxZ: 4 }, // length is 12, not 10!
        boundary: { perimeterWalls: [] },
        barriers: [],
        surfaceZones: [],
      };

      const res = validateArena(mismatchedArena);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain(
        "Inconsistent X dimensions: bounds span 12.0000 m (maxX 6 - minX -6) does not match dimensions.lengthM 10.0000 m."
      );
    });

    it("rejects duplicate barrier IDs across interior and perimeter barriers", () => {
      const arenaWithDupes: ArenaConfig = {
        id: "dupe-barrier-arena",
        name: "Arena with duplicate barrier",
        dimensions: { lengthM: 10, widthM: 10 },
        bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
        boundary: {
          perimeterWalls: [
            {
              id: "shared-wall-id",
              geometryType: "rectangle",
              position: { x: 5, z: 0 },
              sizeX: 0.2,
              sizeZ: 10,
            },
          ],
        },
        barriers: [
          {
            id: "shared-wall-id", // DUPLICATE ID
            geometryType: "rectangle",
            position: { x: 0, z: 0 },
            sizeX: 1,
            sizeZ: 1,
          },
        ],
        surfaceZones: [],
      };

      const res = validateArena(arenaWithDupes);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain(
        'Duplicate barrier ID "shared-wall-id" detected in arena barriers.'
      );
    });

    it("rejects duplicate surface zone IDs", () => {
      const arenaWithDupes: ArenaConfig = {
        id: "dupe-zone-arena",
        name: "Arena with duplicate zones",
        dimensions: { lengthM: 10, widthM: 10 },
        bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
        boundary: { perimeterWalls: [] },
        barriers: [],
        surfaceZones: [
          {
            id: "zone-1",
            shape: "rectangle",
            bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
            surface: "concrete",
          },
          {
            id: "zone-1", // DUPLICATE
            shape: "rectangle",
            bounds: { minX: 2, maxX: 3, minZ: 2, maxZ: 3 },
            surface: "wood",
          },
        ],
      };

      const res = validateArena(arenaWithDupes);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain(
        'Duplicate surface zone ID "zone-1" detected.'
      );
    });

    it("warns if surface zone extends beyond arena bounds", () => {
      const arenaWithOverflowZone: ArenaConfig = {
        id: "overflow-arena",
        name: "Arena with overflowing zone",
        dimensions: { lengthM: 10, widthM: 10 },
        bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
        boundary: { perimeterWalls: [] },
        barriers: [],
        surfaceZones: [
          {
            id: "zone-outside",
            shape: "rectangle",
            bounds: { minX: 4, maxX: 8, minZ: 0, maxZ: 2 }, // maxX 8 > 5
            surface: "concrete",
          },
        ],
      };

      const res = validateArena(arenaWithOverflowZone);
      expect(res.isValid).toBe(true); // Still structurally valid
      expect(res.warnings).toHaveLength(1);
      expect(res.warnings[0]).toContain(
        'Surface zone "zone-outside" extends beyond arena bounds.'
      );
    });
  });

  describe("5. Spatial Surface Zone Querying & Deterministic Precedence", () => {
    const arenaWithZones: ArenaConfig = {
      id: "arena-precedence",
      name: "Precedence Arena",
      dimensions: { lengthM: 20, widthM: 20 },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      boundary: { perimeterWalls: [] },
      barriers: [],
      fallbackSurface: "steel", // default arena floor (μs = 0.85)
      surfaceZones: [
        {
          id: "zone-low-priority-wood",
          name: "Wooden Floor Area",
          shape: "rectangle",
          bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
          surface: "wood", // μs = 0.70
          priority: 1,
        },
        {
          id: "zone-high-priority-ice",
          name: "Ice Patch Overlay",
          shape: "rectangle",
          bounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
          surface: "low-grip", // μs = 0.20
          priority: 10,
        },
        {
          id: "zone-medium-priority-rubber",
          name: "Rubber Mat Overlay",
          shape: "rectangle",
          bounds: { minX: 0, maxX: 3, minZ: 0, maxZ: 3 },
          surface: "rubber-high-grip", // μs = 1.15
          priority: 5,
        },
      ],
    };

    it("resolves to arena fallback surface outside all surface zones", () => {
      // Point (8, 8) is inside the arena but outside all 3 zones
      expect(isPointInsideArenaBounds({ x: 8, z: 8 }, arenaWithZones)).toBe(
        true
      );
      const surface = resolveSurfaceAtPoint(arenaWithZones, 8, 8);
      expect(surface.id).toBe("steel");
      expect(surface.staticFrictionCoeff).toBe(0.85);
    });

    it("resolves to single active zone when no overlaps occur", () => {
      // Point (-3, -3) is inside zone-low-priority-wood (bounds [-4, 4]), but outside [-2, 2] and [0, 3]
      const surface = resolveSurfaceAtPoint(arenaWithZones, -3, -3);
      expect(surface.id).toBe("wood");
      expect(surface.staticFrictionCoeff).toBe(0.7);
    });

    it("strictly respects priority precedence when multiple zones overlap", () => {
      // Point (1, 1) is inside:
      // - zone-low-priority-wood (priority 1)
      // - zone-medium-priority-rubber (priority 5)
      // - zone-high-priority-ice (priority 10)
      const matchingZones = findActiveSurfaceZonesAtPoint(
        arenaWithZones,
        1,
        1
      );
      expect(matchingZones).toHaveLength(3);
      expect(matchingZones[0].id).toBe("zone-high-priority-ice");
      expect(matchingZones[1].id).toBe("zone-medium-priority-rubber");
      expect(matchingZones[2].id).toBe("zone-low-priority-wood");

      const resolved = resolveSurfaceAtPoint(arenaWithZones, 1, 1);
      expect(resolved.id).toBe("low-grip");
      expect(resolved.staticFrictionCoeff).toBe(0.2);
    });

    it("applies deterministic tie-breaking by ID when priority is identical", () => {
      const arenaWithTies: ArenaConfig = {
        id: "arena-tie",
        name: "Tie Arena",
        dimensions: { lengthM: 10, widthM: 10 },
        bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
        boundary: { perimeterWalls: [] },
        barriers: [],
        surfaceZones: [
          {
            id: "zone-b-rubber",
            shape: "rectangle",
            bounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
            surface: "rubber-high-grip", // μs = 1.15
            priority: 5,
          },
          {
            id: "zone-a-concrete",
            shape: "rectangle",
            bounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
            surface: "concrete", // μs = 0.90
            priority: 5, // SAME PRIORITY!
          },
        ],
      };

      // Both have priority 5. Deterministic tie-breaker selects "zone-a-concrete" because "zone-a" < "zone-b"
      const matching = findActiveSurfaceZonesAtPoint(arenaWithTies, 0, 0);
      expect(matching[0].id).toBe("zone-a-concrete");
      expect(matching[1].id).toBe("zone-b-rubber");

      const resolved = resolveSurfaceAtPoint(arenaWithTies, 0, 0);
      expect(resolved.id).toBe("concrete");

      // Verify independence from array insertion order: reverse the zones array and test again
      const reversedArena: ArenaConfig = {
        ...arenaWithTies,
        surfaceZones: [...arenaWithTies.surfaceZones].reverse(),
      };
      const resolvedReversed = resolveSurfaceAtPoint(reversedArena, 0, 0);
      expect(resolvedReversed.id).toBe("concrete");
    });
  });

  describe("6. Coordinate Conventions & Perimeter Walls", () => {
    it("respects coordinate convention: X = longitudinal, Z = lateral", () => {
      const bounds: ArenaBounds2D = {
        minX: -10, // rear (-X)
        maxX: 10, // front (+X)
        minZ: -5, // right (-Z)
        maxZ: 5, // left (+Z)
      };

      const walls = generatePerimeterWalls(bounds, {
        wallThicknessM: 0.2,
        wallHeightM: 1.5,
      });

      expect(walls).toHaveLength(4);

      const northWall = walls.find((w) => w.id === "perimeter-wall-north-x-pos");
      const southWall = walls.find((w) => w.id === "perimeter-wall-south-x-neg");
      const westWall = walls.find((w) => w.id === "perimeter-wall-west-z-pos");
      const eastWall = walls.find((w) => w.id === "perimeter-wall-east-z-neg");

      expect(northWall).toBeDefined();
      expect(southWall).toBeDefined();
      expect(westWall).toBeDefined();
      expect(eastWall).toBeDefined();

      // North (+X front): located at X = maxX + thickness/2 = 10.1
      expect(northWall!.position.x).toBeCloseTo(10.1);
      expect(northWall!.position.z).toBeCloseTo(0);
      expect(northWall!.sizeX).toBeCloseTo(0.2); // thickness along X
      expect(northWall!.sizeZ).toBeCloseTo(10.4); // spans width along Z + corners

      // South (-X rear): located at X = minX - thickness/2 = -10.1
      expect(southWall!.position.x).toBeCloseTo(-10.1);
      expect(southWall!.position.z).toBeCloseTo(0);

      // West (+Z left): located at Z = maxZ + thickness/2 = 5.1
      expect(westWall!.position.x).toBeCloseTo(0);
      expect(westWall!.position.z).toBeCloseTo(5.1);
      expect(westWall!.sizeX).toBeCloseTo(20); // spans full length along X
      expect(westWall!.sizeZ).toBeCloseTo(0.2); // thickness along Z

      // East (-Z right): located at Z = minZ - thickness/2 = -5.1
      expect(eastWall!.position.x).toBeCloseTo(0);
      expect(eastWall!.position.z).toBeCloseTo(-5.1);
    });
  });

  describe("7. Standard Competition Arena Preset", () => {
    it("STANDARD_ROBOT_WARS_ARENA passes all validation rules with zero errors", () => {
      const validation = validateArena(STANDARD_ROBOT_WARS_ARENA);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toEqual([]);
      expect(validation.warnings).toEqual([]);
    });

    it("STANDARD_ROBOT_WARS_ARENA has expected 12m x 12m bounds and steel floor", () => {
      expect(STANDARD_ROBOT_WARS_ARENA.dimensions.lengthM).toBe(12.0);
      expect(STANDARD_ROBOT_WARS_ARENA.dimensions.widthM).toBe(12.0);
      expect(STANDARD_ROBOT_WARS_ARENA.bounds.minX).toBe(-6.0);
      expect(STANDARD_ROBOT_WARS_ARENA.bounds.maxX).toBe(6.0);
      expect(STANDARD_ROBOT_WARS_ARENA.bounds.minZ).toBe(-6.0);
      expect(STANDARD_ROBOT_WARS_ARENA.bounds.maxZ).toBe(6.0);
      expect(STANDARD_ROBOT_WARS_ARENA.fallbackSurface).toBe(
        DEFAULT_GROUND_SURFACE
      );

      // Resolves to steel everywhere by default
      const centerSurface = resolveSurfaceAtPoint(
        STANDARD_ROBOT_WARS_ARENA,
        0,
        0
      );
      expect(centerSurface.id).toBe("steel");
      expect(centerSurface.staticFrictionCoeff).toBe(0.85);

      const cornerSurface = resolveSurfaceAtPoint(
        STANDARD_ROBOT_WARS_ARENA,
        5.5,
        -5.5
      );
      expect(cornerSurface.id).toBe("steel");
    });
  });
});
