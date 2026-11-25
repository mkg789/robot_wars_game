import { describe, expect, it } from "vitest";
import type { ArenaConfig } from "../types/arena.types";
import type { SimulationRobotConfig } from "../types/simulation.types";
import {
  createRectangularArena,
  STANDARD_ROBOT_WARS_ARENA,
} from "./arenaModel";
import {
  checkAabbOverlap,
  computeAabbFromVertices,
  computeObbVertices,
  createRobotCollisionEnvelope,
  deriveRobotCollisionEnvelope,
  deriveRobotFootprintDimensions,
  detectArenaCollisions,
  filterBroadPhaseCandidates,
  testObbAabbCollision,
} from "./collisionModel";

describe("Phase 4.1.3: Planar Collision Detection Foundation", () => {
  describe("1. Robot Collision Geometry & OBB Generation", () => {
    it("generates exact OBB vertices aligned with coordinate conventions at heading 0", () => {
      // Robot at center (0, 0), length = 2.0 (along X), width = 1.0 (along Z), heading = 0
      const vertices = computeObbVertices(
        { x: 0, z: 0 },
        2.0,
        1.0,
        0
      );

      // Half-length = 1.0, Half-width = 0.5
      // Front-Left (+X, +Z)
      expect(vertices.frontLeft.x).toBeCloseTo(1.0);
      expect(vertices.frontLeft.z).toBeCloseTo(0.5);

      // Front-Right (+X, -Z)
      expect(vertices.frontRight.x).toBeCloseTo(1.0);
      expect(vertices.frontRight.z).toBeCloseTo(-0.5);

      // Rear-Right (-X, -Z)
      expect(vertices.rearRight.x).toBeCloseTo(-1.0);
      expect(vertices.rearRight.z).toBeCloseTo(-0.5);

      // Rear-Left (-X, +Z)
      expect(vertices.rearLeft.x).toBeCloseTo(-1.0);
      expect(vertices.rearLeft.z).toBeCloseTo(0.5);
    });

    it("correctly rotates vertices counter-clockwise in X-Z plane at heading pi/2 (90° left toward +Z)", () => {
      // Robot at center (0, 0), length = 2.0, width = 1.0, heading = π/2
      // At 90° CCW: forward vector points along +Z, left vector points along -X
      const vertices = computeObbVertices(
        { x: 0, z: 0 },
        2.0,
        1.0,
        Math.PI / 2
      );

      // Front is at +Z (z = 1.0), Rear is at -Z (z = -1.0)
      // Left is at -X (x = -0.5), Right is at +X (x = 0.5)
      expect(vertices.frontLeft.x).toBeCloseTo(-0.5);
      expect(vertices.frontLeft.z).toBeCloseTo(1.0);

      expect(vertices.frontRight.x).toBeCloseTo(0.5);
      expect(vertices.frontRight.z).toBeCloseTo(1.0);

      expect(vertices.rearRight.x).toBeCloseTo(0.5);
      expect(vertices.rearRight.z).toBeCloseTo(-1.0);

      expect(vertices.rearLeft.x).toBeCloseTo(-0.5);
      expect(vertices.rearLeft.z).toBeCloseTo(-1.0);
    });

    it("computes exact AABB for unrotated and rotated OBB envelopes", () => {
      // At heading 0: AABB matches OBB extents
      const env0 = createRobotCollisionEnvelope(
        { x: 3, z: -2, headingRadians: 0 },
        { lengthM: 2.0, widthM: 1.0 }
      );

      expect(env0.aabb.minX).toBeCloseTo(2.0); // 3 - 1.0
      expect(env0.aabb.maxX).toBeCloseTo(4.0); // 3 + 1.0
      expect(env0.aabb.minZ).toBeCloseTo(-2.5); // -2 - 0.5
      expect(env0.aabb.maxZ).toBeCloseTo(-1.5); // -2 + 0.5

      // At heading 45° (π/4): extents expand symmetrically
      const env45 = createRobotCollisionEnvelope(
        { x: 0, z: 0, headingRadians: Math.PI / 4 },
        { lengthM: 2.0, widthM: 1.0 }
      );

      // Δx = hL * cos(45°) + hW * sin(45°) = 1.0 * √2/2 + 0.5 * √2/2 = 1.5 * √2/2 ≈ 1.06066
      const expectedDelta = 1.5 * Math.SQRT1_2;
      expect(env45.aabb.maxX).toBeCloseTo(expectedDelta);
      expect(env45.aabb.minX).toBeCloseTo(-expectedDelta);
      expect(env45.aabb.maxZ).toBeCloseTo(expectedDelta);
      expect(env45.aabb.minZ).toBeCloseTo(-expectedDelta);

      // Directly verify computeAabbFromVertices output
      const rawAabb = computeAabbFromVertices(env45.vertices);
      expect(rawAabb.maxX).toBeCloseTo(expectedDelta);
      expect(rawAabb.minX).toBeCloseTo(-expectedDelta);
    });

    it("rejects non-positive dimensions and non-finite coordinates", () => {
      expect(() =>
        createRobotCollisionEnvelope(
          { x: 0, z: 0, headingRadians: 0 },
          { lengthM: -1, widthM: 1 }
        )
      ).toThrow(/strictly positive/);

      expect(() =>
        createRobotCollisionEnvelope(
          { x: Number.NaN, z: 0, headingRadians: 0 },
          { lengthM: 1, widthM: 1 }
        )
      ).toThrow(/finite/);
    });

    it("derives footprint from 4WD and 2WD SimulationRobotConfigs", () => {
      const config4wd: SimulationRobotConfig = {
        totalMassKg: 10,
        centerOfMass: { x: 0, y: 0.05, z: 0 },
        yawInertiaKgM2: 0.2,
        trackWidthM: 0.6,
        wheelbaseM: 0.4,
        drivetrain: {
          type: "differential-4",
          drivenWheelCount: 4,
          leftSlotCount: 2,
          rightSlotCount: 2,
        },
        motors: [],
        wheels: [
          {
            wheelId: "w1",
            name: "Wheel",
            side: "left",
            slotIndex: 0,
            diameterM: 0.12,
            radiusM: 0.06,
            widthM: 0.04,
            provenance: { source: "test", verified: true },
          },
        ],
        battery: null,
        normalLoads: null,
        assumptions: [],
        validity: "valid",
        warnings: [],
      };

      const fp4wd = deriveRobotFootprintDimensions(config4wd);
      expect(fp4wd.source).toBe("drivetrain-geometry");
      expect(fp4wd.lengthM).toBeCloseTo(0.4 + 0.12); // wheelbase + diameter
      expect(fp4wd.widthM).toBeCloseTo(0.6 + 0.04); // trackWidth + wheelWidth

      // 2WD configuration with null wheelbase uses fallback heuristic
      const config2wd: SimulationRobotConfig = {
        ...config4wd,
        wheelbaseM: null,
        drivetrain: {
          type: "differential-2",
          drivenWheelCount: 2,
          leftSlotCount: 1,
          rightSlotCount: 1,
        },
      };

      const fp2wd = deriveRobotFootprintDimensions(config2wd);
      expect(fp2wd.source).toBe("fallback-heuristic");
      expect(fp2wd.lengthM).toBeGreaterThan(0);
      expect(fp2wd.widthM).toBeCloseTo(0.6 + 0.04);

      // deriveRobotCollisionEnvelope integrates directly with config
      const env = deriveRobotCollisionEnvelope(config4wd, {
        x: 1,
        z: 2,
        headingRadians: 0,
      });
      expect(env.position.x).toBe(1);
      expect(env.position.z).toBe(2);
      expect(env.lengthM).toBeCloseTo(0.52);
    });
  });

  describe("2. Broad-Phase AABB Candidate Filtering", () => {
    it("checkAabbOverlap accurately detects overlapping and disjoint AABBs", () => {
      const boxA = { minX: 0, maxX: 2, minZ: 0, maxZ: 2 };
      const boxB = { minX: 1, maxX: 3, minZ: 1, maxZ: 3 }; // overlaps
      const boxC = { minX: 3, maxX: 5, minZ: 3, maxZ: 5 }; // separated

      expect(checkAabbOverlap(boxA, boxB)).toBe(true);
      expect(checkAabbOverlap(boxA, boxC)).toBe(false);
    });

    it("filterBroadPhaseCandidates excludes disjoint barriers in arena query", () => {
      const robotAabb = { minX: 4, maxX: 6, minZ: -1, maxZ: 1 };

      const barriers = [
        {
          id: "wall-near",
          geometryType: "rectangle" as const,
          position: { x: 5.5, z: 0 },
          sizeX: 0.2,
          sizeZ: 10,
        },
        {
          id: "wall-far",
          geometryType: "rectangle" as const,
          position: { x: -5.5, z: 0 },
          sizeX: 0.2,
          sizeZ: 10,
        },
      ];

      const candidates = filterBroadPhaseCandidates(robotAabb, barriers);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe("wall-near");
    });
  });

  describe("3. Narrow-Phase SAT Collision Testing", () => {
    const barrierCenterPillar = {
      id: "pillar",
      name: "Center Pillar",
      isPerimeter: false,
      geometryType: "rectangle" as const,
      position: { x: 0, z: 0 },
      sizeX: 2.0, // bounds: X in [-1, 1]
      sizeZ: 2.0, // bounds: Z in [-1, 1]
    };

    it("returns null when robot is clearly separated from barrier", () => {
      // Robot at x = 3.0, half-length = 0.5 -> robot X in [2.5, 3.5], pillar X in [-1, 1]
      const robot = createRobotCollisionEnvelope(
        { x: 3.0, z: 0, headingRadians: 0 },
        { lengthM: 1.0, widthM: 1.0 }
      );

      const contact = testObbAabbCollision(robot, barrierCenterPillar);
      expect(contact).toBeNull();
    });

    it("detects axis-aligned edge collision and calculates correct normal and penetration", () => {
      // Robot at x = 1.4, half-length = 0.5 -> robot front is at 1.9, rear at 0.9.
      // Pillar bounds: [-1, 1]. Overlap along X = 1.0 (pillar maxX) - 0.9 (robot rear) = 0.1 m!
      const robot = createRobotCollisionEnvelope(
        { x: 1.4, z: 0, headingRadians: 0 },
        { lengthM: 1.0, widthM: 1.0 }
      );

      const contact = testObbAabbCollision(robot, barrierCenterPillar);
      expect(contact).not.toBeNull();
      expect(contact!.barrierId).toBe("pillar");
      expect(contact!.classification).toBe("interior-barrier");

      // Collision normal points FROM barrier INTO robot (i.e. toward +X)
      expect(contact!.normal.x).toBeCloseTo(1.0);
      expect(contact!.normal.z).toBeCloseTo(0.0);

      // Penetration depth = (r_obb + r_barrier) - |dx| = (0.5 + 1.0) - 1.4 = 0.1 m
      expect(contact!.penetrationDepth).toBeCloseTo(0.1, 4);
    });

    it("correctly identifies non-collision when robot is rotated near a corner (broad-phase false positive)", () => {
      // Robot at x = 1.3, z = 1.3 with length 0.8, width 0.4.
      // When unrotated, its corner touches (1.3 - 0.4 = 0.9, 1.3 - 0.2 = 1.1).
      // When rotated at 45° pointing away, the SAT accurately detects separation!
      const robotRotatedAway = createRobotCollisionEnvelope(
        { x: 1.6, z: 1.6, headingRadians: Math.PI / 4 },
        { lengthM: 0.6, widthM: 0.2 }
      );

      const contact = testObbAabbCollision(robotRotatedAway, barrierCenterPillar);
      expect(contact).toBeNull();
    });

    it("detects rotated robot corner collision", () => {
      // Robot rotated 45° with front corner penetrating into the barrier
      const robotRotatedIn = createRobotCollisionEnvelope(
        { x: 1.2, z: 0, headingRadians: Math.PI / 4 },
        { lengthM: 1.0, widthM: 0.4 }
      );

      const contact = testObbAabbCollision(robotRotatedIn, barrierCenterPillar);
      expect(contact).not.toBeNull();
      expect(contact!.penetrationDepth).toBeGreaterThan(0);
      // Normal points from pillar into robot
      expect(contact!.normal.x).toBeGreaterThan(0);
    });
  });

  describe("4. Arena Perimeter Wall Collision Queries & Normal Conventions", () => {
    // 10m x 10m arena: bounds X in [-5, 5], Z in [-5, 5]
    const arena10x10 = createRectangularArena({
      id: "arena-10x10",
      name: "10x10 Test Arena",
      lengthM: 10,
      widthM: 10,
      wallThicknessM: 0.2,
    });

    it("detects collision with North (+X) perimeter wall and normal points in -X", () => {
      // North wall is at X = 5.0. Robot center at X = 4.8, length = 1.0 (front at X = 5.3)
      const robotNorth = createRobotCollisionEnvelope(
        { x: 4.8, z: 0, headingRadians: 0 },
        { lengthM: 1.0, widthM: 0.8 }
      );

      const res = detectArenaCollisions(robotNorth, arena10x10);
      expect(res.hasCollision).toBe(true);
      expect(res.collisionCount).toBe(1);

      const col = res.collisions[0];
      expect(col.barrierId).toBe("perimeter-wall-north-x-pos");
      expect(col.classification).toBe("perimeter-wall");

      // Normal points FROM North wall INTO robot (toward -X)
      expect(col.normal.x).toBeCloseTo(-1.0);
      expect(col.normal.z).toBeCloseTo(0.0);
      // Penetration = 5.3 - 5.0 = 0.3 m
      expect(col.penetrationDepth).toBeCloseTo(0.3, 3);
    });

    it("detects collision with South (-X) perimeter wall and normal points in +X", () => {
      // South wall is at X = -5.0. Robot center at X = -4.8, length = 1.0 (rear at X = -5.3)
      const robotSouth = createRobotCollisionEnvelope(
        { x: -4.8, z: 0, headingRadians: 0 },
        { lengthM: 1.0, widthM: 0.8 }
      );

      const res = detectArenaCollisions(robotSouth, arena10x10);
      expect(res.hasCollision).toBe(true);
      expect(res.collisions[0].barrierId).toBe("perimeter-wall-south-x-neg");
      // Normal points FROM South wall INTO robot (toward +X)
      expect(res.collisions[0].normal.x).toBeCloseTo(1.0);
      expect(res.collisions[0].normal.z).toBeCloseTo(0.0);
    });

    it("detects collision with West (+Z) perimeter wall and normal points in -Z", () => {
      // West wall is at Z = 5.0. Robot center at Z = 4.8, width = 0.8 (left edge at Z = 5.2)
      const robotWest = createRobotCollisionEnvelope(
        { x: 0, z: 4.8, headingRadians: 0 },
        { lengthM: 1.0, widthM: 0.8 }
      );

      const res = detectArenaCollisions(robotWest, arena10x10);
      expect(res.hasCollision).toBe(true);
      expect(res.collisions[0].barrierId).toBe("perimeter-wall-west-z-pos");
      // Normal points FROM West wall INTO robot (toward -Z)
      expect(res.collisions[0].normal.x).toBeCloseTo(0.0);
      expect(res.collisions[0].normal.z).toBeCloseTo(-1.0);
    });

    it("detects collision with East (-Z) perimeter wall and normal points in +Z", () => {
      // East wall is at Z = -5.0. Robot center at Z = -4.8, width = 0.8 (right edge at Z = -5.2)
      const robotEast = createRobotCollisionEnvelope(
        { x: 0, z: -4.8, headingRadians: 0 },
        { lengthM: 1.0, widthM: 0.8 }
      );

      const res = detectArenaCollisions(robotEast, arena10x10);
      expect(res.hasCollision).toBe(true);
      expect(res.collisions[0].barrierId).toBe("perimeter-wall-east-z-neg");
      // Normal points FROM East wall INTO robot (toward +Z)
      expect(res.collisions[0].normal.x).toBeCloseTo(0.0);
      expect(res.collisions[0].normal.z).toBeCloseTo(1.0);
    });

    it("detects multiple simultaneous collisions in an arena corner (North + West walls)", () => {
      // Robot at corner (4.8, 4.8) penetrates both North wall (+X) and West wall (+Z)
      const robotCorner = createRobotCollisionEnvelope(
        { x: 4.8, z: 4.8, headingRadians: 0 },
        { lengthM: 1.0, widthM: 1.0 }
      );

      const res = detectArenaCollisions(robotCorner, arena10x10);
      expect(res.hasCollision).toBe(true);
      expect(res.collisionCount).toBe(2);

      const barrierIds = res.collisions.map((c) => c.barrierId);
      expect(barrierIds).toContain("perimeter-wall-north-x-pos");
      expect(barrierIds).toContain("perimeter-wall-west-z-pos");
    });
  });

  describe("5. Query Determinism & Invariance to Barrier Ordering", () => {
    it("sorts collision contacts deterministically by barrierId regardless of barrier array order", () => {
      const arenaWithMultipleBarriers: ArenaConfig = {
        id: "arena-order-test",
        name: "Order Test Arena",
        dimensions: { lengthM: 10, widthM: 10 },
        bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
        boundary: { perimeterWalls: [] },
        barriers: [
          {
            id: "barrier-z-third",
            geometryType: "rectangle",
            position: { x: 0, z: 0 },
            sizeX: 2,
            sizeZ: 2,
          },
          {
            id: "barrier-a-first",
            geometryType: "rectangle",
            position: { x: 0, z: 0 },
            sizeX: 2,
            sizeZ: 2,
          },
          {
            id: "barrier-m-second",
            geometryType: "rectangle",
            position: { x: 0, z: 0 },
            sizeX: 2,
            sizeZ: 2,
          },
        ],
        surfaceZones: [],
      };

      const robot = createRobotCollisionEnvelope(
        { x: 0, z: 0, headingRadians: 0 },
        { lengthM: 1.0, widthM: 1.0 }
      );

      const res1 = detectArenaCollisions(robot, arenaWithMultipleBarriers);
      expect(res1.collisionCount).toBe(3);
      // Must be sorted alphabetically by barrierId: a, m, z
      expect(res1.collisions[0].barrierId).toBe("barrier-a-first");
      expect(res1.collisions[1].barrierId).toBe("barrier-m-second");
      expect(res1.collisions[2].barrierId).toBe("barrier-z-third");

      // Reverse the barriers array in the arena configuration
      const reversedArena: ArenaConfig = {
        ...arenaWithMultipleBarriers,
        barriers: [...arenaWithMultipleBarriers.barriers].reverse(),
      };

      const res2 = detectArenaCollisions(robot, reversedArena);
      expect(res2.collisionCount).toBe(3);
      expect(res2.collisions[0].barrierId).toBe("barrier-a-first");
      expect(res2.collisions[1].barrierId).toBe("barrier-m-second");
      expect(res2.collisions[2].barrierId).toBe("barrier-z-third");
    });

    it("STANDARD_ROBOT_WARS_ARENA query detects robot at center without collisions", () => {
      const robotCenter = createRobotCollisionEnvelope(
        { x: 0, z: 0, headingRadians: 0 },
        { lengthM: 0.8, widthM: 0.6 }
      );

      const res = detectArenaCollisions(robotCenter, STANDARD_ROBOT_WARS_ARENA);
      expect(res.hasCollision).toBe(false);
      expect(res.collisionCount).toBe(0);
      expect(res.collisions).toHaveLength(0);
    });

    it("detects touching barrier on exact boundary with non-negative penetration", () => {
      // Barrier centered at (0, 0), sizeX = 2.0 (X in [-1, 1])
      // Robot at x = 1.5, length = 1.0 (X in [1.0, 2.0]) -> touches boundary at X = 1.0!
      const barrier = {
        id: "touch-barrier",
        geometryType: "rectangle" as const,
        position: { x: 0, z: 0 },
        sizeX: 2.0,
        sizeZ: 2.0,
      };

      const robotTouching = createRobotCollisionEnvelope(
        { x: 1.5, z: 0, headingRadians: 0 },
        { lengthM: 1.0, widthM: 1.0 }
      );

      const contact = testObbAabbCollision(robotTouching, barrier);
      expect(contact).not.toBeNull();
      expect(contact!.penetrationDepth).toBeCloseTo(0, 5);
      expect(contact!.normal.x).toBeCloseTo(1.0);
    });

    it("respects collision query filter options (includePerimeterWalls and includeInteriorBarriers)", () => {
      const arenaWithBoth: ArenaConfig = {
        id: "arena-both",
        name: "Both Arena",
        dimensions: { lengthM: 10, widthM: 10 },
        bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
        boundary: {
          perimeterWalls: [
            {
              id: "wall-north",
              isPerimeter: true,
              geometryType: "rectangle",
              position: { x: 5, z: 0 },
              sizeX: 0.2,
              sizeZ: 10,
            },
          ],
        },
        barriers: [
          {
            id: "obstacle-center",
            isPerimeter: false,
            geometryType: "rectangle",
            position: { x: 5, z: 0 }, // co-located for testing options filtering
            sizeX: 0.2,
            sizeZ: 10,
          },
        ],
        surfaceZones: [],
      };

      const robot = createRobotCollisionEnvelope(
        { x: 4.8, z: 0, headingRadians: 0 },
        { lengthM: 1.0, widthM: 1.0 }
      );

      // Default: queries both
      const resAll = detectArenaCollisions(robot, arenaWithBoth);
      expect(resAll.collisionCount).toBe(2);

      // Exclude perimeter walls
      const resNoPerimeter = detectArenaCollisions(robot, arenaWithBoth, {
        includePerimeterWalls: false,
      });
      expect(resNoPerimeter.collisionCount).toBe(1);
      expect(resNoPerimeter.collisions[0].barrierId).toBe("obstacle-center");

      // Exclude interior barriers
      const resNoInterior = detectArenaCollisions(robot, arenaWithBoth, {
        includeInteriorBarriers: false,
      });
      expect(resNoInterior.collisionCount).toBe(1);
      expect(resNoInterior.collisions[0].barrierId).toBe("wall-north");
    });

    it("guarantees query purity: robot pose and envelope remain strictly unmutated", () => {
      const originalEnvelope = createRobotCollisionEnvelope(
        { x: 4.8, z: 0, headingRadians: 0.25 },
        { lengthM: 1.0, widthM: 0.8 },
        "bot-1"
      );

      const cloneEnvelope = JSON.parse(JSON.stringify(originalEnvelope));

      detectArenaCollisions(originalEnvelope, STANDARD_ROBOT_WARS_ARENA);

      expect(originalEnvelope.position.x).toBe(cloneEnvelope.position.x);
      expect(originalEnvelope.position.z).toBe(cloneEnvelope.position.z);
      expect(originalEnvelope.headingRadians).toBe(cloneEnvelope.headingRadians);
      expect(originalEnvelope.vertices).toEqual(cloneEnvelope.vertices);
      expect(originalEnvelope.aabb).toEqual(cloneEnvelope.aabb);
    });

    it("computes centered contactPoint for flat-face wall hit and offset contactPoint for partial face overlap", () => {
      // Centered flat-face hit against North wall (X = 5.0)
      const robotFlat = createRobotCollisionEnvelope(
        { x: 4.6, z: 0, headingRadians: 0 },
        { lengthM: 1.0, widthM: 0.8 }
      );
      const flatRes = testObbAabbCollision(robotFlat, {
        id: "wall-north",
        isPerimeter: true,
        geometryType: "rectangle",
        position: { x: 5.1, z: 0 },
        sizeX: 0.2,
        sizeZ: 10,
      });
      expect(flatRes).not.toBeNull();
      expect(flatRes!.contactPoint.z).toBeCloseTo(0, 6);

      // Partial face overlap against small off-center barrier (barrier Z in [0.2, 0.6], robot Z in [-0.4, 0.4])
      // Overlap along Z is [0.2, 0.4] -> midpoint Z = 0.3
      const partialRes = testObbAabbCollision(robotFlat, {
        id: "partial-block",
        isPerimeter: false,
        geometryType: "rectangle",
        position: { x: 5.5, z: 0.4 },
        sizeX: 1.0, // X in [5.0, 6.0]
        sizeZ: 0.4, // Z in [0.2, 0.6]
      });
      expect(partialRes).not.toBeNull();
      expect(partialRes!.contactPoint.z).toBeCloseTo(0.3, 6);
    });
  });
});
