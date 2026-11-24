import { describe, expect, it } from "vitest";
import type {
  BoxGeometry,
  CartesianBoundingExtents,
  CartesianBoundingTuple,
  CylinderGeometry,
} from "../types/dimensions.types";
import {
  toBoundingBoxExtents,
  toBoundingExtentsObject,
  toBoundingTuple,
  getPartBoundingExtents,
  getPartBoxExtents,
  getPartCylinderDimensions,
  resolveWheelDiameter,
  resolveWheelDimensions,
  resolveWheelRadius,
} from "./geometryAdapters";

describe("geometryAdapters", () => {
  describe("toBoundingBoxExtents", () => {
    it("converts BoxGeometry into Cartesian [length, height, width] extents", () => {
      const box: BoxGeometry = {
        shape: "box",
        length: 2.0, // X axis (Front-Rear)
        height: 0.35, // Y axis (Up-Down)
        width: 1.5, // Z axis (Left-Right)
      };

      const extents = toBoundingBoxExtents(box);

      expect(extents).toEqual([2.0, 0.35, 1.5]);
      expect(extents[0]).toBe(box.length);
      expect(extents[1]).toBe(box.height);
      expect(extents[2]).toBe(box.width);
    });

    it("converts CylinderGeometry with axis 'x' to [axialWidth, diameter, diameter]", () => {
      // Cylinder with symmetry axis along X (e.g. drive wheel)
      const wheel: CylinderGeometry = {
        shape: "cylinder",
        diameter: 0.22,
        axialWidth: 0.07,
        axis: "x",
      };

      const extents = toBoundingBoxExtents(wheel);

      expect(extents).toEqual([0.07, 0.22, 0.22]);
      expect(extents[0]).toBe(wheel.axialWidth);
      expect(extents[1]).toBe(wheel.diameter);
      expect(extents[2]).toBe(wheel.diameter);
    });

    it("converts CylinderGeometry with axis 'y' to [diameter, axialWidth, diameter]", () => {
      // Cylinder with symmetry axis along Y (e.g. horizontal spinning disc)
      const spinningDisc: CylinderGeometry = {
        shape: "cylinder",
        diameter: 0.35,
        axialWidth: 0.02,
        axis: "y",
      };

      const extents = toBoundingBoxExtents(spinningDisc);

      expect(extents).toEqual([0.35, 0.02, 0.35]);
      expect(extents[0]).toBe(spinningDisc.diameter);
      expect(extents[1]).toBe(spinningDisc.axialWidth);
      expect(extents[2]).toBe(spinningDisc.diameter);
    });

    it("converts CylinderGeometry with axis 'z' to [diameter, diameter, axialWidth]", () => {
      // Cylinder with symmetry axis along Z (e.g. transverse roller)
      const roller: CylinderGeometry = {
        shape: "cylinder",
        diameter: 0.1,
        axialWidth: 0.5,
        axis: "z",
      };

      const extents = toBoundingBoxExtents(roller);

      expect(extents).toEqual([0.1, 0.1, 0.5]);
      expect(extents[0]).toBe(roller.diameter);
      expect(extents[1]).toBe(roller.diameter);
      expect(extents[2]).toBe(roller.axialWidth);
    });

    it("passes through zero dimensions without modification", () => {
      const zeroBox: BoxGeometry = {
        shape: "box",
        length: 0,
        height: 0,
        width: 0,
      };
      const zeroCylinder: CylinderGeometry = {
        shape: "cylinder",
        diameter: 0,
        axialWidth: 0,
        axis: "x",
      };

      expect(toBoundingBoxExtents(zeroBox)).toEqual([0, 0, 0]);
      expect(toBoundingBoxExtents(zeroCylinder)).toEqual([0, 0, 0]);
    });

    it("passes through negative or unusual values without clamping or validation", () => {
      const negativeBox: BoxGeometry = {
        shape: "box",
        length: -1.5,
        height: -0.5,
        width: -0.8,
      };

      expect(toBoundingBoxExtents(negativeBox)).toEqual([-1.5, -0.5, -0.8]);
    });

    it("preserves exact floating point precision without rounding", () => {
      const preciseBox: BoxGeometry = {
        shape: "box",
        length: 0.123456789,
        height: 0.987654321,
        width: 0.555555555,
      };

      const extents = toBoundingBoxExtents(preciseBox);

      expect(extents[0]).toBe(0.123456789);
      expect(extents[1]).toBe(0.987654321);
      expect(extents[2]).toBe(0.555555555);
    });
  });

  describe("toBoundingExtentsObject", () => {
    it("converts CartesianBoundingTuple [X, Y, Z] into named object { x, y, z }", () => {
      const tuple: CartesianBoundingTuple = [1.8, 0.45, 1.2];

      const obj = toBoundingExtentsObject(tuple);

      expect(obj).toEqual({
        x: 1.8,
        y: 0.45,
        z: 1.2,
      });
      expect(obj.x).toBe(tuple[0]);
      expect(obj.y).toBe(tuple[1]);
      expect(obj.z).toBe(tuple[2]);
    });
  });

  describe("toBoundingTuple", () => {
    it("converts CartesianBoundingExtents object { x, y, z } into tuple [x, y, z]", () => {
      const obj: CartesianBoundingExtents = {
        x: 2.4,
        y: 0.3,
        z: 1.6,
      };

      const tuple = toBoundingTuple(obj);

      expect(tuple).toEqual([2.4, 0.3, 1.6]);
      expect(tuple[0]).toBe(obj.x);
      expect(tuple[1]).toBe(obj.y);
      expect(tuple[2]).toBe(obj.z);
    });
  });

  describe("roundtrip and preservation of ordering", () => {
    it("faithfully preserves axis ordering across roundtrip conversions", () => {
      const originalTuple: CartesianBoundingTuple = [1.25, 0.75, 2.5];

      const asObject = toBoundingExtentsObject(originalTuple);
      const restoredTuple = toBoundingTuple(asObject);

      expect(restoredTuple).toEqual(originalTuple);
      expect(restoredTuple[0]).toBe(originalTuple[0]);
      expect(restoredTuple[1]).toBe(originalTuple[1]);
      expect(restoredTuple[2]).toBe(originalTuple[2]);
    });
  });

  describe("getPartBoundingExtents", () => {
    it("returns Cartesian extents for BoxGeometry", () => {
      const part = {
        size: [1.0, 0.5, 0.8] as [number, number, number],
        geometry: {
          shape: "box" as const,
          length: 2.2,
          height: 0.4,
          width: 1.6,
        },
      };

      expect(getPartBoundingExtents(part)).toEqual([2.2, 0.4, 1.6]);
    });

    it("returns Cartesian extents for CylinderGeometry respecting symmetry axis", () => {
      const xCylinder = {
        size: [0.3, 0.1, 0.3] as [number, number, number],
        geometry: {
          shape: "cylinder" as const,
          diameter: 0.3,
          axialWidth: 0.1,
          axis: "x" as const,
        },
      };
      expect(getPartBoundingExtents(xCylinder)).toEqual([0.1, 0.3, 0.3]);

      const zCylinder = {
        size: [0.3, 0.1, 0.3] as [number, number, number],
        geometry: {
          shape: "cylinder" as const,
          diameter: 0.25,
          axialWidth: 0.6,
          axis: "z" as const,
        },
      };
      expect(getPartBoundingExtents(zCylinder)).toEqual([0.25, 0.25, 0.6]);
    });

    it("falls back to legacy part.size when canonical geometry is undefined", () => {
      const legacyPart = {
        size: [1.5, 0.3, 0.9] as [number, number, number],
      };
      expect(getPartBoundingExtents(legacyPart)).toEqual([1.5, 0.3, 0.9]);
    });

    it("prefers canonical geometry when canonical and legacy size differ", () => {
      const conflictingPart = {
        size: [99.0, 99.0, 99.0] as [number, number, number],
        geometry: {
          shape: "box" as const,
          length: 2.0,
          height: 0.5,
          width: 1.2,
        },
      };
      expect(getPartBoundingExtents(conflictingPart)).toEqual([2.0, 0.5, 1.2]);
    });
  });

  describe("getPartBoxExtents", () => {
    it("extracts [length, height, width] for box components", () => {
      const part = {
        size: [1, 1, 1] as [number, number, number],
        geometry: {
          shape: "box" as const,
          length: 3.1,
          height: 0.45,
          width: 2.0,
        },
      };
      expect(getPartBoxExtents(part)).toEqual([3.1, 0.45, 2.0]);
    });

    it("falls back to legacy part.size when geometry is missing", () => {
      const part = {
        size: [1.8, 0.2, 1.0] as [number, number, number],
      };
      expect(getPartBoxExtents(part)).toEqual([1.8, 0.2, 1.0]);
    });

    it("prefers canonical geometry when canonical and legacy size differ", () => {
      const part = {
        size: [5.0, 5.0, 5.0] as [number, number, number],
        geometry: {
          shape: "box" as const,
          length: 1.4,
          height: 0.3,
          width: 0.8,
        },
      };
      expect(getPartBoxExtents(part)).toEqual([1.4, 0.3, 0.8]);
    });
  });

  describe("getPartCylinderDimensions", () => {
    it("extracts canonical radius, diameter, and width from CylinderGeometry", () => {
      const wheel = {
        size: [0.22, 0.07, 0.22] as [number, number, number],
        wheelDiameter: 0.22,
        wheelWidth: 0.07,
        geometry: {
          shape: "cylinder" as const,
          diameter: 0.32,
          axialWidth: 0.12,
          axis: "x" as const,
        },
      };

      const result = getPartCylinderDimensions(wheel);
      expect(result.diameter).toBe(0.32);
      expect(result.width).toBe(0.12);
      expect(result.radius).toBe(0.16);
    });

    it("falls back to legacy wheelDiameter and wheelWidth", () => {
      const legacyWheel = {
        size: [0.28, 0.09, 0.28] as [number, number, number],
        wheelDiameter: 0.28,
        wheelWidth: 0.09,
      };

      const result = getPartCylinderDimensions(legacyWheel);
      expect(result.diameter).toBe(0.28);
      expect(result.width).toBe(0.09);
      expect(result.radius).toBe(0.14);
    });

    it("falls back to legacy part.size[0] and part.size[1] if wheelDiameter/wheelWidth are absent", () => {
      const legacyPart = {
        size: [0.4, 0.15, 0.4] as [number, number, number],
      };

      const result = getPartCylinderDimensions(legacyPart);
      expect(result.diameter).toBe(0.4);
      expect(result.width).toBe(0.15);
      expect(result.radius).toBe(0.2);
    });

    it("prefers canonical geometry when canonical and legacy wheel dimensions differ", () => {
      const conflictingWheel = {
        size: [0.1, 0.02, 0.1] as [number, number, number],
        wheelDiameter: 0.1,
        wheelWidth: 0.02,
        geometry: {
          shape: "cylinder" as const,
          diameter: 0.36,
          axialWidth: 0.14,
          axis: "x" as const,
        },
      };

      const result = getPartCylinderDimensions(conflictingWheel);
      expect(result.diameter).toBe(0.36);
      expect(result.width).toBe(0.14);
      expect(result.radius).toBe(0.18);
    });
  });

  describe("resolveWheelDimensions", () => {
    it("resolves canonical cylinder wheel geometry", () => {
      const wheel = {
        id: "wheel-std",
        name: "Standard Rubber Wheel",
        size: [0.22, 0.07, 0.22] as [number, number, number],
        geometry: {
          shape: "cylinder" as const,
          diameter: 0.22,
          axialWidth: 0.07,
          axis: "x" as const,
        },
      };

      const res = resolveWheelDimensions(wheel);
      expect(res.isValid).toBe(true);
      expect(res.diameterM).toBe(0.22);
      expect(res.radiusM).toBe(0.11);
      expect(res.widthM).toBe(0.07);
      expect(res.source).toBe("canonical-cylinder");
      expect(res.failureReason).toBeUndefined();

      expect(resolveWheelDiameter(wheel)).toBe(0.22);
      expect(resolveWheelRadius(wheel)).toBe(0.11);
    });

    it("prefers explicit wheelDiameter when provided and valid", () => {
      const customWheel = {
        id: "wheel-custom",
        name: "Custom Wheel",
        size: [0.2, 0.05, 0.2] as [number, number, number],
        wheelDiameter: 0.3,
        wheelWidth: 0.08,
        geometry: {
          shape: "cylinder" as const,
          diameter: 0.25,
          axialWidth: 0.06,
          axis: "x" as const,
        },
      };

      const res = resolveWheelDimensions(customWheel);
      expect(res.isValid).toBe(true);
      expect(res.diameterM).toBe(0.3);
      expect(res.radiusM).toBe(0.15);
      expect(res.widthM).toBe(0.08);
      expect(res.source).toBe("explicit-wheel-diameter");
    });

    it("falls back to legacy part.size[0] when geometry is absent", () => {
      const legacyWheel = {
        id: "wheel-legacy",
        name: "Legacy Wheel",
        size: [0.24, 0.09, 0.24] as [number, number, number],
      };

      const res = resolveWheelDimensions(legacyWheel);
      expect(res.isValid).toBe(true);
      expect(res.diameterM).toBe(0.24);
      expect(res.radiusM).toBe(0.12);
      expect(res.widthM).toBe(0.09);
      expect(res.source).toBe("legacy-size");
    });

    it("rejects unsupported geometry shape (e.g. BoxGeometry) for a wheel", () => {
      const boxWheel = {
        id: "wheel-box",
        name: "Wedge/Box Wheel",
        size: [0.5, 0.2, 0.3] as [number, number, number],
        geometry: {
          shape: "box" as const,
          length: 0.5,
          height: 0.2,
          width: 0.3,
        },
      };

      const res = resolveWheelDimensions(boxWheel);
      expect(res.isValid).toBe(false);
      expect(res.diameterM).toBe(0);
      expect(res.radiusM).toBe(0);
      expect(res.source).toBe("none");
      expect(res.failureReason).toBe("unsupported-shape");
      expect(res.warning).toContain("unsupported geometry shape \"box\"");

      expect(resolveWheelDiameter(boxWheel)).toBe(0);
      expect(resolveWheelRadius(boxWheel)).toBe(0);
    });

    it("rejects invalid cylinder geometry with non-positive or non-finite diameter", () => {
      const zeroCyl = {
        id: "wheel-zero",
        name: "Zero Cylinder",
        size: [0, 0, 0] as [number, number, number],
        geometry: {
          shape: "cylinder" as const,
          diameter: 0,
          axialWidth: 0.05,
          axis: "x" as const,
        },
      };

      const res = resolveWheelDimensions(zeroCyl);
      expect(res.isValid).toBe(false);
      expect(res.failureReason).toBe("invalid-geometry");

      const nanCyl = {
        id: "wheel-nan",
        name: "NaN Cylinder",
        size: [0.2, 0.05, 0.2] as [number, number, number],
        geometry: {
          shape: "cylinder" as const,
          diameter: NaN,
          axialWidth: 0.05,
          axis: "x" as const,
        },
      };

      const resNan = resolveWheelDimensions(nanCyl);
      expect(resNan.isValid).toBe(false);
      expect(resNan.failureReason).toBe("invalid-geometry");
    });

    it("rejects missing geometry when size is also absent or invalid", () => {
      const missingWheel = {
        id: "wheel-none",
        name: "Missing Wheel",
        size: [0, 0, 0] as [number, number, number],
      };

      const res = resolveWheelDimensions(missingWheel);
      expect(res.isValid).toBe(false);
      expect(res.failureReason).toBe("non-positive");
    });

    it("guarantees mathematical consistency between wheel diameter and wheel radius", () => {
      const testCases = [
        { diameter: 0.16, axialWidth: 0.055 },
        { diameter: 0.22, axialWidth: 0.07 },
        { diameter: 0.28, axialWidth: 0.1 },
      ];

      for (const tc of testCases) {
        const wheel = {
          size: [tc.diameter, tc.axialWidth, tc.diameter] as [number, number, number],
          geometry: {
            shape: "cylinder" as const,
            diameter: tc.diameter,
            axialWidth: tc.axialWidth,
            axis: "x" as const,
          },
        };
        const res = resolveWheelDimensions(wheel);
        expect(res.isValid).toBe(true);
        expect(res.radiusM).toBe(res.diameterM / 2);
        expect(resolveWheelRadius(wheel)).toBe(resolveWheelDiameter(wheel) / 2);
      }
    });
  });
});
