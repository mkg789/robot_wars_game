import { describe, expect, it } from "vitest";
import { batteryCatalogue } from "./batteryCatalogue";
import { controllerCatalogue } from "./controllerCatalogue";
import { foundationModels } from "./foundationModels";
import { motorCatalogue } from "./motorCatalogue";
import { wheelCatalogue } from "./wheelCatalogue";
import { toBoundingBoxExtents } from "../logic/geometryAdapters";

describe("Catalogue Migration: Canonical Dimensional & Physical Types", () => {
  describe("foundationModels", () => {
    it("contains all 3 foundation models with canonical BoxGeometry", () => {
      expect(foundationModels).toHaveLength(3);

      for (const model of foundationModels) {
        expect(model.geometry.shape).toBe("box");
        expect(model.geometry.length).toBe(model.length);
        expect(model.geometry.height).toBe(model.height);
        expect(model.geometry.width).toBe(model.width);

        // Verify adapter converts to Cartesian [X, Y, Z] = [length, height, width]
        expect(toBoundingBoxExtents(model.geometry)).toEqual([
          model.length,
          model.height,
          model.width,
        ]);
      }
    });

    it("preserves legacy fields and visual icons", () => {
      const square = foundationModels.find((m) => m.id === "compact-square");
      expect(square?.name).toBe("Compact Square");
      expect(square?.icon).toBe("▣");
    });
  });

  describe("motorCatalogue", () => {
    it("contains all 3 motors with canonical BoxGeometry and mechanical specs", () => {
      expect(motorCatalogue).toHaveLength(3);

      for (const motor of motorCatalogue) {
        expect(motor.geometry.shape).toBe("box");
        expect(motor.geometry.length).toBe(motor.dimensions[0]);
        expect(motor.geometry.height).toBe(motor.dimensions[1]);
        expect(motor.geometry.width).toBe(motor.dimensions[2]);

        // Output shaft extends along X; extents match legacy dimensions tuple
        expect(toBoundingBoxExtents(motor.geometry)).toEqual(motor.dimensions);

        // Physical properties
        expect(motor.massKg).toBe(motor.weight);
        expect(motor.mechanical.stallTorqueNm).toBe(motor.torque);
        expect(motor.mechanical.noLoadRpm).toBe(motor.rpm);
      }
    });

    it("preserves legacy fields and mounting footprint", () => {
      const standardMotor = motorCatalogue.find((m) => m.id === "standard-dc");
      expect(standardMotor?.mountingFootprint).toEqual([0.54, 0.42]);
      expect(standardMotor?.color).toBe("#f97316");
    });
  });

  describe("wheelCatalogue", () => {
    it("contains all 4 wheels with canonical CylinderGeometry and explicit 'x' axis", () => {
      expect(wheelCatalogue).toHaveLength(4);

      for (const wheel of wheelCatalogue) {
        expect(wheel.geometry.shape).toBe("cylinder");
        expect(wheel.geometry.axis).toBe("x");
        expect(wheel.geometry.diameter).toBe(wheel.diameter);
        expect(wheel.geometry.axialWidth).toBe(wheel.width);

        // Bounding box for cylinder with axis 'x': [axialWidth, diameter, diameter]
        expect(toBoundingBoxExtents(wheel.geometry)).toEqual([
          wheel.width,
          wheel.diameter,
          wheel.diameter,
        ]);

        // Physical mass
        expect(wheel.massKg).toBe(wheel.weight);
      }
    });

    it("preserves legacy wheel categories and motor compatibility", () => {
      const omni = wheelCatalogue.find((w) => w.id === "small-omni");
      expect(omni?.category).toBe("Omni");
      expect(omni?.compatibleMotorIds).toEqual(["small-dc", "standard-dc"]);
    });
  });

  describe("batteryCatalogue", () => {
    it("contains all 3 batteries with canonical BoxGeometry and electrical specs", () => {
      expect(batteryCatalogue).toHaveLength(3);

      for (const battery of batteryCatalogue) {
        expect(battery.geometry.shape).toBe("box");
        expect(battery.geometry.length).toBe(battery.dimensions.length);
        expect(battery.geometry.height).toBe(battery.dimensions.height);
        expect(battery.geometry.width).toBe(battery.dimensions.width);

        // Bounding box [X, Y, Z] = [length, height, width]
        expect(toBoundingBoxExtents(battery.geometry)).toEqual([
          battery.dimensions.length,
          battery.dimensions.height,
          battery.dimensions.width,
        ]);

        // Physical mass and electrical specs
        expect(battery.massKg).toBe(battery.weight);
        expect(battery.electrical.nominalVoltageV).toBe(battery.voltage);
        expect(battery.electrical.capacityMah).toBe(battery.capacityMah);
      }
    });

    it("preserves chemistry and color metadata", () => {
      const heavyLipo = batteryCatalogue.find((b) => b.id === "heavy-duty-lipo");
      expect(heavyLipo?.chemistry).toBe("LiPo");
      expect(heavyLipo?.color).toBe("#7c2d12");
    });
  });

  describe("controllerCatalogue", () => {
    it("contains all 3 controllers with canonical BoxGeometry and electrical specs", () => {
      expect(controllerCatalogue).toHaveLength(3);

      for (const controller of controllerCatalogue) {
        expect(controller.geometry.shape).toBe("box");
        expect(controller.geometry.length).toBe(controller.dimensions.length);
        expect(controller.geometry.height).toBe(controller.dimensions.height);
        expect(controller.geometry.width).toBe(controller.dimensions.width);

        // Bounding box [X, Y, Z] = [length, height, width]
        expect(toBoundingBoxExtents(controller.geometry)).toEqual([
          controller.dimensions.length,
          controller.dimensions.height,
          controller.dimensions.width,
        ]);

        // Physical mass
        expect(controller.massKg).toBe(controller.weight);
      }
    });

    it("correctly parses nominal voltage and does not fabricate missing specs", () => {
      const uno = controllerCatalogue.find((c) => c.id === "arduino-uno");
      const esp = controllerCatalogue.find((c) => c.id === "esp32-devkit");
      const stm = controllerCatalogue.find((c) => c.id === "stm32-nucleo");

      expect(uno?.electrical.nominalVoltageV).toBe(5.0);
      expect(esp?.electrical.nominalVoltageV).toBe(3.3);
      expect(stm?.electrical.nominalVoltageV).toBe(3.3);

      // Unspecified properties are not fabricated
      expect(uno?.electrical.capacityMah).toBeUndefined();
      expect(uno?.electrical.continuousCurrentA).toBeUndefined();
      expect(uno?.electrical.peakCurrentA).toBeUndefined();
    });

    it("preserves legacy processor, clockMHz, and controllerType", () => {
      const esp = controllerCatalogue.find((c) => c.id === "esp32-devkit");
      expect(esp?.processor).toBe("ESP32");
      expect(esp?.clockMHz).toBe(240);
      expect(esp?.operatingVoltage).toBe("3.3V");
      expect(esp?.controllerType).toBe("Wireless development board");
    });
  });
});
