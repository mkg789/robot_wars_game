import { describe, expect, it } from "vitest";
import {
  createRectangularArena,
  STANDARD_ROBOT_WARS_ARENA,
} from "./arenaModel";
import {
  computeDefaultSimulationCameraPose,
  computeFollowCameraDelta,
  computeFollowSimulationCameraPose,
  computeInspectionSimulationCameraPose,
} from "./simulationCamera";
import {
  mapKeyboardKeyToDriveAction,
  OBSTACLE_TEST_ARENA,
} from "./simulationWorld";

describe("Phase 4.4: Simulation Camera & Control Helpers", () => {
  it("computes arena-scaled default overview camera pose behind -X facing into the arena", () => {
    const pose12 = computeDefaultSimulationCameraPose(STANDARD_ROBOT_WARS_ARENA);
    expect(pose12.target).toEqual([0, 0.25, 0]);
    expect(pose12.position[0]).toBeLessThan(0); // behind robot (-X)
    expect(pose12.position[1]).toBeGreaterThan(4); // elevated
    expect(pose12.minDistance).toBeGreaterThan(0);
    expect(pose12.maxDistance).toBeGreaterThan(pose12.minDistance);

    const largeArena = createRectangularArena({
      id: "large-24x24",
      name: "Large 24x24",
      lengthM: 24,
      widthM: 24,
    });
    const pose24 = computeDefaultSimulationCameraPose(largeArena);
    expect(pose24.position[1]).toBeGreaterThan(pose12.position[1]);
    expect(pose24.maxDistance).toBeGreaterThan(pose12.maxDistance);
  });

  it("computes follow camera pose centered on robot and incremental translation deltas", () => {
    const followPose = computeFollowSimulationCameraPose(
      { xMeters: 3.5, zMeters: -1.2 },
      OBSTACLE_TEST_ARENA
    );
    expect(followPose.target).toEqual([3.5, 0.25, -1.2]);
    expect(followPose.position[0]).toBeCloseTo(3.5 - 3.8, 5);
    expect(followPose.position[2]).toBeCloseTo(-1.2 + 2.8, 5);

    const delta = computeFollowCameraDelta(
      { x: 1.0, z: -0.5 },
      { xMeters: 1.4, zMeters: 0.2 }
    );
    expect(delta.dx).toBeCloseTo(0.4, 6);
    expect(delta.dz).toBeCloseTo(0.7, 6);

    // Non-finite guard
    expect(
      computeFollowCameraDelta({ x: NaN, z: 0 }, { xMeters: 1, zMeters: 1 })
    ).toEqual({ dx: 0, dz: 0 });
  });

  it("maps WASD (case-insensitive) and Arrow keys deterministically without unmapped keys", () => {
    expect(mapKeyboardKeyToDriveAction("w")).toBe("forward");
    expect(mapKeyboardKeyToDriveAction("W")).toBe("forward");
    expect(mapKeyboardKeyToDriveAction("ArrowUp")).toBe("forward");

    expect(mapKeyboardKeyToDriveAction("s")).toBe("reverse");
    expect(mapKeyboardKeyToDriveAction("ArrowDown")).toBe("reverse");

    expect(mapKeyboardKeyToDriveAction("a")).toBe("left");
    expect(mapKeyboardKeyToDriveAction("ArrowLeft")).toBe("left");

    expect(mapKeyboardKeyToDriveAction("d")).toBe("right");
    expect(mapKeyboardKeyToDriveAction("ArrowRight")).toBe("right");

    expect(mapKeyboardKeyToDriveAction("q")).toBeNull();
    expect(mapKeyboardKeyToDriveAction("Escape")).toBeNull();
  });

  it("computes robot-relative front, rear, left, right, top, and overview inspection camera poses", () => {
    const robotPose = { xMeters: 2.0, zMeters: -1.5, headingRadians: 0 };
    const footprint = { lengthM: 2.2, widthM: 1.6 };

    const front = computeInspectionSimulationCameraPose({
      preset: "front",
      arena: OBSTACLE_TEST_ARENA,
      robotPose,
      footprint,
    });
    expect(front.position[0]).toBeGreaterThan(2.0);
    expect(front.position[2]).toBeCloseTo(-1.5, 5);
    expect(front.target).toEqual([2.0, 0.22, -1.5]);

    const rear = computeInspectionSimulationCameraPose({
      preset: "rear",
      arena: OBSTACLE_TEST_ARENA,
      robotPose,
      footprint,
    });
    expect(rear.position[0]).toBeLessThan(2.0);
    expect(rear.position[2]).toBeCloseTo(-1.5, 5);

    const left = computeInspectionSimulationCameraPose({
      preset: "left",
      arena: OBSTACLE_TEST_ARENA,
      robotPose,
      footprint,
    });
    expect(left.position[0]).toBeCloseTo(2.0, 5);
    expect(left.position[2]).toBeGreaterThan(-1.5);

    const right = computeInspectionSimulationCameraPose({
      preset: "right",
      arena: OBSTACLE_TEST_ARENA,
      robotPose,
      footprint,
    });
    expect(right.position[0]).toBeCloseTo(2.0, 5);
    expect(right.position[2]).toBeLessThan(-1.5);

    const top = computeInspectionSimulationCameraPose({
      preset: "top",
      arena: OBSTACLE_TEST_ARENA,
      robotPose,
      footprint,
    });
    expect(top.position[1]).toBeGreaterThan(3.0);

    // Rotated robot heading (+pi/2 points robot +X forward along +Z)
    const rotatedFront = computeInspectionSimulationCameraPose({
      preset: "front",
      arena: OBSTACLE_TEST_ARENA,
      robotPose: { xMeters: 0, zMeters: 0, headingRadians: Math.PI / 2 },
      footprint,
    });
    expect(rotatedFront.position[0]).toBeCloseTo(0, 4);
    expect(rotatedFront.position[2]).toBeGreaterThan(2.0);

    // Larger footprint frames further out without clipping
    const largerLeft = computeInspectionSimulationCameraPose({
      preset: "left",
      arena: OBSTACLE_TEST_ARENA,
      robotPose,
      footprint: { lengthM: 3.6, widthM: 2.8 },
    });
    expect(largerLeft.position[2] - (-1.5)).toBeGreaterThan(
      left.position[2] - (-1.5)
    );
  });
});
