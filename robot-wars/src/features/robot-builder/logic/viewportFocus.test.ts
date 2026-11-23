import { describe, expect, it } from "vitest";

import type { RobotPart } from "../types/robot.types";
import {
  getAssemblyFocusFrame,
  getCameraFocusDistance,
  getComponentFocusFrame,
  getVisibleSelectedPart,
} from "./viewportFocus";

function makePart(overrides: Partial<RobotPart> = {}): RobotPart {
  return {
    id: "part-1",
    name: "Test part",
    type: "Structural Block",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [2, 1, 1],
    color: "#64748b",
    mass: 1,
    ...overrides,
  };
}

describe("viewport focus helpers", () => {
  it("frames the selected component at its actual position and size", () => {
    const component = makePart({
      position: [2, 0.5, -1],
      size: [2, 1, 1],
    });

    expect(getComponentFocusFrame(component)).toEqual({
      target: component.position,
      radius: Math.hypot(1, 0.5, 0.5),
    });
  });

  it("does not resolve a hidden component or an empty selection", () => {
    const component = makePart();
    const parts = [component];

    expect(getVisibleSelectedPart(parts, component.id, [])).toBe(component);
    expect(
      getVisibleSelectedPart(parts, component.id, [component.id])
    ).toBeNull();
    expect(getVisibleSelectedPart(parts, null, [])).toBeNull();
  });

  it("frames the full assembly and computes a valid distance for the viewport", () => {
    const parts = [
      makePart({ position: [-2, 0, 0] }),
      makePart({ id: "part-2", position: [2, 0, 0] }),
    ];
    const frame = getAssemblyFocusFrame(parts);

    expect(frame).not.toBeNull();
    expect(frame?.target[0]).toBeCloseTo(0);
    expect(frame?.target[1]).toBeCloseTo(0);
    expect(frame?.target[2]).toBeCloseTo(0);
    expect(frame?.radius).toBeGreaterThan(2);
    expect(
      getCameraFocusDistance(frame?.radius ?? 0, 44, 1.5)
    ).toBeGreaterThan(frame?.radius ?? 0);
    expect(getAssemblyFocusFrame([])).toBeNull();
  });

  it("frames a wheel component using normalized [diameter, width, diameter] extents", () => {
    const wheel = makePart({
      type: "Wheel",
      position: [0, 0.5, 0.5],
      size: [0.34, 0.12, 0.34], // [diameter, width, diameter]
    });

    expect(getComponentFocusFrame(wheel)).toEqual({
      target: wheel.position,
      radius: Math.hypot(0.17, 0.06, 0.17),
    });
  });
});
