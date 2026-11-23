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

  it("frames a component using canonical BoxGeometry", () => {
    const boxPart = makePart({
      position: [1, 2, 3],
      size: [1, 1, 1], // legacy size
      geometry: {
        shape: "box",
        length: 2.4,
        height: 0.6,
        width: 1.8,
      },
    });

    expect(getComponentFocusFrame(boxPart)).toEqual({
      target: [1, 2, 3],
      radius: Math.hypot(1.2, 0.3, 0.9),
    });
  });

  it("frames a cylindrical component using canonical CylinderGeometry", () => {
    const wheel = makePart({
      type: "Wheel",
      position: [0, 0.5, 0.5],
      size: [0.1, 0.1, 0.1], // legacy size differs
      geometry: {
        shape: "cylinder",
        diameter: 0.4,
        axialWidth: 0.14,
        axis: "x",
      },
    });

    // Cartesian bounding box for cylinder with axis "x" is [axialWidth, diameter, diameter]
    expect(getComponentFocusFrame(wheel)).toEqual({
      target: [0, 0.5, 0.5],
      radius: Math.hypot(0.07, 0.2, 0.2),
    });
  });

  it("demonstrates canonical-first behaviour when canonical geometry and legacy size differ", () => {
    const conflictingPart = makePart({
      position: [0, 0, 0],
      size: [0.2, 0.2, 0.2], // small legacy size
      geometry: {
        shape: "box",
        length: 4.0,
        height: 2.0,
        width: 2.0,
      },
    });

    const frame = getComponentFocusFrame(conflictingPart);
    expect(frame.radius).toBe(Math.hypot(2.0, 1.0, 1.0));
    expect(frame.radius).not.toBe(Math.hypot(0.1, 0.1, 0.1));
  });

  it("computes assembly focus frame from canonical bounds", () => {
    const partA = makePart({
      position: [-2, 0, 0],
      geometry: { shape: "box", length: 2, height: 1, width: 1 },
    });
    const partB = makePart({
      id: "part-b",
      position: [2, 0, 0],
      geometry: { shape: "box", length: 2, height: 1, width: 1 },
    });

    const frame = getAssemblyFocusFrame([partA, partB]);
    expect(frame).not.toBeNull();
    expect(frame?.target[0]).toBeCloseTo(0);
    expect(frame?.radius).toBeGreaterThan(2);
  });
});
