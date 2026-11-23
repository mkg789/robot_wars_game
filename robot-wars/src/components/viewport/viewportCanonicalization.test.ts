import { describe, expect, it } from "vitest";
import type { RobotPart } from "../../features/robot-builder/types/robot.types";
import {
  getPartBoxExtents,
  getPartCylinderDimensions,
  getPartBoundingExtents,
} from "../../features/robot-builder/logic/geometryAdapters";
import { wheelCatalogue } from "../../features/robot-builder/data/wheelCatalogue";

describe("Phase 2.4C.4.4: Viewport Consumer Canonicalization", () => {
  describe("Model Box Extent Resolution (RobotObject)", () => {
    it("resolves canonical box extents for foundation chassis", () => {
      const chassis: RobotPart = {
        id: "foundation-chassis",
        name: "Main Chassis",
        type: "Armor Plate",
        position: [0, 0.2, 0],
        rotation: [0, 0, 0],
        size: [2.0, 0.4, 1.5],
        color: "#334155",
        mass: 15,
        geometry: {
          shape: "box",
          length: 2.4,
          height: 0.45,
          width: 1.8,
        },
      };

      const extents = getPartBoxExtents(chassis);
      expect(extents).toEqual([2.4, 0.45, 1.8]);
    });

    it("resolves canonical box extents for motors", () => {
      const motor: RobotPart = {
        id: "motor-1",
        name: "Drive Motor",
        type: "Motor",
        position: [0.5, 0.2, 0.5],
        rotation: [0, 0, 0],
        size: [0.38, 0.34, 0.42],
        color: "#ef4444",
        mass: 1.2,
        geometry: {
          shape: "box",
          length: 0.38,
          height: 0.34,
          width: 0.42,
        },
      };

      const extents = getPartBoxExtents(motor);
      expect(extents).toEqual([0.38, 0.34, 0.42]);
    });

    it("resolves canonical box extents for batteries", () => {
      const battery: RobotPart = {
        id: "battery-1",
        name: "LiPo Pack",
        type: "Battery",
        batteryCatalogueId: "standard-lipo",
        position: [0, 0.25, 0],
        rotation: [0, 0, 0],
        size: [0.2, 0.04, 0.09],
        color: "#3b82f6",
        mass: 0.8,
        geometry: {
          shape: "box",
          length: 0.2,
          height: 0.04,
          width: 0.09,
        },
      };

      const extents = getPartBoxExtents(battery);
      expect(extents).toEqual([0.2, 0.04, 0.09]);
    });

    it("resolves canonical box extents for controllers", () => {
      const controller: RobotPart = {
        id: "controller-1",
        name: "Microcontroller",
        type: "Controller",
        controllerCatalogueId: "arduino-uno",
        position: [0, 0.25, 0],
        rotation: [0, 0, 0],
        size: [0.055, 0.01, 0.028],
        color: "#10b981",
        mass: 0.05,
        geometry: {
          shape: "box",
          length: 0.055,
          height: 0.01,
          width: 0.028,
        },
      };

      const extents = getPartBoxExtents(controller);
      expect(extents).toEqual([0.055, 0.01, 0.028]);
    });

    it("falls back to legacy part.size when canonical geometry is omitted", () => {
      const legacyPart: RobotPart = {
        id: "legacy-bumper",
        name: "Front Bumper",
        type: "Front Bumper",
        position: [1, 0, 0],
        rotation: [0, 0, 0],
        size: [0.12, 0.25, 1.2],
        color: "#f59e0b",
        mass: 2,
      };

      expect(getPartBoxExtents(legacyPart)).toEqual([0.12, 0.25, 1.2]);
      expect(getPartBoundingExtents(legacyPart)).toEqual([0.12, 0.25, 1.2]);
    });
  });

  describe("Wheel Cylinder Dimension Resolution (WheelModel & RobotScene)", () => {
    it("resolves canonical radius, diameter, and width for wheels", () => {
      const wheel: RobotPart = {
        id: "wheel-1",
        name: "Drive Wheel",
        type: "Wheel",
        wheelCatalogueId: "standard-rubber",
        position: [0.5, 0.2, 0.6],
        rotation: [0, 0, 0],
        size: [0.22, 0.07, 0.22],
        color: "#171b22",
        mass: 0.6,
        wheelDiameter: 0.22,
        wheelWidth: 0.07,
        geometry: {
          shape: "cylinder",
          diameter: 0.26,
          axialWidth: 0.09,
          axis: "x",
        },
      };

      const dims = getPartCylinderDimensions(wheel);
      expect(dims.diameter).toBe(0.26);
      expect(dims.width).toBe(0.09);
      expect(dims.radius).toBe(0.13);
    });

    it("falls back to legacy wheelDiameter and wheelWidth when geometry is omitted", () => {
      const legacyWheel: RobotPart = {
        id: "wheel-legacy",
        name: "Legacy Wheel",
        type: "Wheel",
        wheelCatalogueId: "standard-rubber",
        position: [0.5, 0.2, 0.6],
        rotation: [0, 0, 0],
        size: [0.22, 0.07, 0.22],
        color: "#171b22",
        mass: 0.6,
        wheelDiameter: 0.22,
        wheelWidth: 0.07,
      };

      const dims = getPartCylinderDimensions(legacyWheel);
      expect(dims.diameter).toBe(0.22);
      expect(dims.width).toBe(0.07);
      expect(dims.radius).toBe(0.11);
    });

    it("correctly matches canonical wheel dimensions in RobotScene draft comparison", () => {
      const standardRubberDef = wheelCatalogue.find(
        (w) => w.id === "standard-rubber"
      )!;

      // Part matching the catalogue draft
      const matchingWheel: RobotPart = {
        id: "wheel-match",
        name: "Matching Wheel",
        type: "Wheel",
        wheelCatalogueId: "standard-rubber",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [standardRubberDef.diameter, standardRubberDef.width, standardRubberDef.diameter],
        color: "#111",
        mass: 1,
        geometry: standardRubberDef.geometry,
      };

      const dims = getPartCylinderDimensions(matchingWheel);
      const matchesDraft =
        matchingWheel.wheelCatalogueId === standardRubberDef.id &&
        Math.abs(dims.diameter - standardRubberDef.diameter) < 0.000001 &&
        Math.abs(dims.width - standardRubberDef.width) < 0.000001;

      expect(matchesDraft).toBe(true);
    });

    it("detects customized wheel dimensions in RobotScene draft comparison", () => {
      const standardRubberDef = wheelCatalogue.find(
        (w) => w.id === "standard-rubber"
      )!;

      // Part with customized canonical dimensions
      const customizedWheel: RobotPart = {
        id: "wheel-custom",
        name: "Customized Wheel",
        type: "Wheel",
        wheelCatalogueId: "standard-rubber",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.35, 0.12, 0.35],
        color: "#111",
        mass: 1,
        geometry: {
          shape: "cylinder",
          diameter: 0.35, // larger than catalogue 0.22
          axialWidth: 0.12, // wider than catalogue 0.07
          axis: "x",
        },
      };

      const dims = getPartCylinderDimensions(customizedWheel);
      const matchesDraft =
        customizedWheel.wheelCatalogueId === standardRubberDef.id &&
        Math.abs(dims.diameter - standardRubberDef.diameter) < 0.000001 &&
        Math.abs(dims.width - standardRubberDef.width) < 0.000001;

      expect(matchesDraft).toBe(false);
    });
  });
});
