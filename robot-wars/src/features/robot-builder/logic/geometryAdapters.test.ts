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
});
