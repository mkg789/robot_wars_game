import { describe, expect, it } from "vitest";
import { batteryCatalogue } from "./batteryCatalogue";
import { controllerCatalogue } from "./controllerCatalogue";
import { foundationModels } from "./foundationModels";
import { motorCatalogue } from "./motorCatalogue";
import { wheelCatalogue } from "./wheelCatalogue";
import { toBoundingBoxExtents } from "../logic/geometryAdapters";
import { resolveComponentEngineeringSpec } from "../logic/engineeringAdapters";
import type { RobotPart } from "../types/robot.types";

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

    it("populates authoritative engineeringSpec on Compact Square", () => {
      const model = foundationModels.find((m) => m.id === "compact-square");
      expect(model?.engineeringSpec).toBeDefined();
      const spec = model!.engineeringSpec!;

      expect(spec.category).toBe("structural");
      expect(spec.role).toBe("chassis-frame");

      // Unsupported properties must remain undefined
      expect(spec.material).toBeUndefined();
      expect(spec.plateThicknessM).toBeUndefined();
      expect(spec.mounting).toBeUndefined();

      // Provenance
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:foundation:compact-square");
        expect(spec.generalProvenance.notes).toContain("Generic game preset");
      }

      // Field provenance
      expect(spec.fieldProvenance?.role?.method).toBe("estimated");
    });

    it("populates authoritative engineeringSpec on Standard Rectangle", () => {
      const model = foundationModels.find((m) => m.id === "standard-rectangular");
      expect(model?.engineeringSpec).toBeDefined();
      const spec = model!.engineeringSpec!;

      expect(spec.category).toBe("structural");
      expect(spec.role).toBe("chassis-frame");

      expect(spec.material).toBeUndefined();
      expect(spec.plateThicknessM).toBeUndefined();
      expect(spec.mounting).toBeUndefined();

      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:foundation:standard-rectangular");
      }
      expect(spec.fieldProvenance?.role?.method).toBe("estimated");
    });

    it("populates authoritative engineeringSpec on Long Frame", () => {
      const model = foundationModels.find((m) => m.id === "long-frame");
      expect(model?.engineeringSpec).toBeDefined();
      const spec = model!.engineeringSpec!;

      expect(spec.category).toBe("structural");
      expect(spec.role).toBe("chassis-frame");

      expect(spec.material).toBeUndefined();
      expect(spec.plateThicknessM).toBeUndefined();
      expect(spec.mounting).toBeUndefined();

      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:foundation:long-frame");
      }
      expect(spec.fieldProvenance?.role?.method).toBe("estimated");
    });

    it("preserves resolver compatibility and non-fabrication for foundation models", () => {
      const part: RobotPart = {
        id: "foundation-chassis",
        name: "Compact Square",
        type: "Structural Block",
        position: [0, 0.14, 0],
        rotation: [0, 0, 0],
        size: [1.6, 0.28, 1.4],
        color: "#475569",
        mass: 1.88,
        geometry: {
          shape: "box",
          length: 1.6,
          height: 0.28,
          width: 1.4,
        },
        massKg: 1.88,
      };

      const resolved = resolveComponentEngineeringSpec(part);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("structural");
      if (resolved?.category === "structural") {
        expect(resolved.role).toBe("chassis-frame");
        expect(resolved.material).toBeUndefined();
        expect(resolved.plateThicknessM).toBeUndefined();
        expect(resolved.mounting).toBeUndefined();
        expect(resolved.generalProvenance?.method).toBe("datasheet");
        if (resolved.generalProvenance?.method === "datasheet") {
          expect(resolved.generalProvenance.verified).toBe(false);
        }
      }
    });

    it("resolves foundation model chassis engineering specification using foundationModelId even when part name is customized", () => {
      const part: RobotPart = {
        id: "foundation-chassis",
        name: "Renamed Battle Bot Frame",
        type: "Structural Block",
        foundationModelId: "long-frame",
        position: [0, 0.16, 0],
        rotation: [0, 0, 0],
        size: [2.6, 0.32, 1.25],
        color: "#475569",
        mass: 3.12,
        geometry: {
          shape: "box",
          length: 2.6,
          height: 0.32,
          width: 1.25,
        },
        massKg: 3.12,
      };

      const resolved = resolveComponentEngineeringSpec(part);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("structural");
      if (resolved?.category === "structural") {
        expect(resolved.role).toBe("chassis-frame");
        if (resolved.generalProvenance?.method === "datasheet") {
          expect(resolved.generalProvenance.source).toBe("catalogue:foundation:long-frame");
        }
      }
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

    it("populates authoritative engineeringSpec on Small DC Gear Motor", () => {
      const motor = motorCatalogue.find((m) => m.id === "small-dc");
      expect(motor?.engineeringSpec).toBeDefined();
      const spec = motor!.engineeringSpec!;

      expect(spec.category).toBe("motor");
      expect(spec.technology).toBe("brushed-dc");

      // Mechanical specs
      expect(spec.mechanical?.stallTorqueNm).toBe(0.35);
      expect(spec.mechanical?.noLoadSpeedRpm).toBe(180);
      expect(spec.mechanical?.ratedTorqueNm).toBeUndefined();
      expect(spec.mechanical?.ratedSpeedRpm).toBeUndefined();
      expect(spec.mechanical?.gearRatio).toBeUndefined();
      expect(spec.mechanical?.gearboxEfficiency).toBeUndefined();

      // Electrical specs unverified and non-fabricated
      expect(spec.electrical).toBeUndefined();

      // Mounting interface
      expect(spec.mounting?.patternType).toBe("face-mount");
      expect(spec.mounting?.footprintDimensionsM).toEqual([0.42, 0, 0.34]);
      expect(spec.mounting?.boltPattern).toBeUndefined();

      // Shaft unverified and non-fabricated
      expect(spec.shaft).toBeUndefined();

      // Provenance: generic preset without manufacturer verification
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:motor:small-dc");
        expect(spec.generalProvenance.notes).toContain("Generic game preset");
      }
      expect(spec.mechanical?.provenance?.method).toBe("datasheet");
      if (spec.mechanical?.provenance?.method === "datasheet") {
        expect(spec.mechanical.provenance.verified).toBe(false);
        expect(spec.mechanical.provenance.source).toBe("catalogue:motor:small-dc");
      }

      // Field provenance
      expect(spec.fieldProvenance?.["mechanical.stallTorqueNm"]?.method).toBe("estimated");
      expect(spec.fieldProvenance?.["mechanical.noLoadSpeedRpm"]?.method).toBe("estimated");
      expect(spec.fieldProvenance?.["mounting.footprintDimensionsM"]?.method).toBe("estimated");
    });

    it("populates authoritative engineeringSpec on Standard DC Gear Motor", () => {
      const motor = motorCatalogue.find((m) => m.id === "standard-dc");
      expect(motor?.engineeringSpec).toBeDefined();
      const spec = motor!.engineeringSpec!;

      expect(spec.category).toBe("motor");
      expect(spec.technology).toBe("brushed-dc");

      // Mechanical specs
      expect(spec.mechanical?.stallTorqueNm).toBe(0.8);
      expect(spec.mechanical?.noLoadSpeedRpm).toBe(150);
      expect(spec.mechanical?.ratedTorqueNm).toBeUndefined();
      expect(spec.mechanical?.ratedSpeedRpm).toBeUndefined();
      expect(spec.mechanical?.gearRatio).toBeUndefined();
      expect(spec.mechanical?.gearboxEfficiency).toBeUndefined();

      // Electrical specs unverified and non-fabricated
      expect(spec.electrical).toBeUndefined();

      // Mounting interface
      expect(spec.mounting?.patternType).toBe("face-mount");
      expect(spec.mounting?.footprintDimensionsM).toEqual([0.54, 0, 0.42]);
      expect(spec.mounting?.boltPattern).toBeUndefined();

      // Shaft unverified and non-fabricated
      expect(spec.shaft).toBeUndefined();

      // Provenance
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:motor:standard-dc");
      }
    });

    it("populates authoritative engineeringSpec on High-Torque DC Gear Motor", () => {
      const motor = motorCatalogue.find((m) => m.id === "high-torque-dc");
      expect(motor?.engineeringSpec).toBeDefined();
      const spec = motor!.engineeringSpec!;

      expect(spec.category).toBe("motor");
      expect(spec.technology).toBe("brushed-dc");

      // Mechanical specs
      expect(spec.mechanical?.stallTorqueNm).toBe(1.6);
      expect(spec.mechanical?.noLoadSpeedRpm).toBe(90);
      expect(spec.mechanical?.ratedTorqueNm).toBeUndefined();
      expect(spec.mechanical?.ratedSpeedRpm).toBeUndefined();
      expect(spec.mechanical?.gearRatio).toBeUndefined();
      expect(spec.mechanical?.gearboxEfficiency).toBeUndefined();

      // Electrical specs unverified and non-fabricated
      expect(spec.electrical).toBeUndefined();

      // Mounting interface
      expect(spec.mounting?.patternType).toBe("face-mount");
      expect(spec.mounting?.footprintDimensionsM).toEqual([0.66, 0, 0.52]);
      expect(spec.mounting?.boltPattern).toBeUndefined();

      // Shaft unverified and non-fabricated
      expect(spec.shaft).toBeUndefined();

      // Provenance
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:motor:high-torque-dc");
      }
    });

    it("preserves resolver compatibility and non-fabrication for catalogue motors", () => {
      const part: RobotPart = {
        id: "motor-instance-1",
        name: "Standard Motor Instance",
        type: "Motor",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.38, 0.34, 0.42],
        color: "#f97316",
        mass: 0.48,
        motorCatalogueId: "standard-dc",
      };

      const resolved = resolveComponentEngineeringSpec(part);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("motor");
      if (resolved?.category === "motor") {
        expect(resolved.technology).toBe("brushed-dc");
        expect(resolved.mechanical?.stallTorqueNm).toBe(0.8);
        expect(resolved.mechanical?.noLoadSpeedRpm).toBe(150);
        expect(resolved.electrical).toBeUndefined();
        expect(resolved.shaft).toBeUndefined();
        expect(resolved.mounting?.patternType).toBe("face-mount");
        expect(resolved.mounting?.footprintDimensionsM).toEqual([0.54, 0, 0.42]);
        expect(resolved.generalProvenance?.method).toBe("datasheet");
        if (resolved.generalProvenance?.method === "datasheet") {
          expect(resolved.generalProvenance.verified).toBe(false);
        }
      }
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

    it("populates authoritative engineeringSpec on Standard Rubber Wheel", () => {
      const wheel = wheelCatalogue.find((w) => w.id === "standard-rubber");
      expect(wheel?.engineeringSpec).toBeDefined();
      const spec = wheel!.engineeringSpec!;

      expect(spec.category).toBe("wheel");
      expect(spec.treadType).toBe("rubber");

      // Unsupported fields must remain undefined
      expect(spec.hub).toBeUndefined();
      expect(spec.traction).toBeUndefined();

      // Provenance
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:wheel:standard-rubber");
        expect(spec.generalProvenance.notes).toContain("Generic game preset");
      }

      // Field provenance
      expect(spec.fieldProvenance?.treadType?.method).toBe("estimated");
    });

    it("populates authoritative engineeringSpec on Heavy-Duty Wheel", () => {
      const wheel = wheelCatalogue.find((w) => w.id === "heavy-duty");
      expect(wheel?.engineeringSpec).toBeDefined();
      const spec = wheel!.engineeringSpec!;

      expect(spec.category).toBe("wheel");
      expect(spec.treadType).toBe("polyurethane");

      expect(spec.hub).toBeUndefined();
      expect(spec.traction).toBeUndefined();

      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:wheel:heavy-duty");
      }
      expect(spec.fieldProvenance?.treadType?.method).toBe("estimated");
    });

    it("populates authoritative engineeringSpec on Grip Wheel", () => {
      const wheel = wheelCatalogue.find((w) => w.id === "grip");
      expect(wheel?.engineeringSpec).toBeDefined();
      const spec = wheel!.engineeringSpec!;

      expect(spec.category).toBe("wheel");
      expect(spec.treadType).toBe("rubber");

      expect(spec.hub).toBeUndefined();
      expect(spec.traction).toBeUndefined();

      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:wheel:grip");
      }
      expect(spec.fieldProvenance?.treadType?.method).toBe("estimated");
    });

    it("populates authoritative engineeringSpec on Small Omni Wheel", () => {
      const wheel = wheelCatalogue.find((w) => w.id === "small-omni");
      expect(wheel?.engineeringSpec).toBeDefined();
      const spec = wheel!.engineeringSpec!;

      expect(spec.category).toBe("wheel");
      expect(spec.treadType).toBe("omni-directional");

      expect(spec.hub).toBeUndefined();
      expect(spec.traction).toBeUndefined();

      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:wheel:small-omni");
      }
      expect(spec.fieldProvenance?.treadType?.method).toBe("estimated");
    });

    it("preserves resolver compatibility and non-fabrication for catalogue wheels", () => {
      const part: RobotPart = {
        id: "wheel-instance-1",
        name: "Standard Rubber Wheel Instance",
        type: "Wheel",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.07, 0.22, 0.22],
        color: "#20242b",
        mass: 0.16,
        wheelCatalogueId: "standard-rubber",
      };

      const resolved = resolveComponentEngineeringSpec(part);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("wheel");
      if (resolved?.category === "wheel") {
        expect(resolved.treadType).toBe("rubber");
        expect(resolved.hub).toBeUndefined();
        expect(resolved.traction).toBeUndefined();
        expect(resolved.generalProvenance?.method).toBe("datasheet");
        if (resolved.generalProvenance?.method === "datasheet") {
          expect(resolved.generalProvenance.verified).toBe(false);
        }
      }
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

    it("populates authoritative engineeringSpec on Compact LiPo", () => {
      const compact = batteryCatalogue.find((b) => b.id === "compact-lipo");
      expect(compact?.engineeringSpec).toBeDefined();
      const spec = compact!.engineeringSpec!;

      expect(spec.category).toBe("battery");
      expect(spec.chemistry).toBe("lipo");
      expect(spec.cellCountS).toBe(2);
      expect(spec.parallelCountP).toBe(1);

      // Electrical specs
      expect(spec.electrical?.nominalVoltageV).toBe(7.4);
      expect(spec.electrical?.fullyChargedVoltageV).toBe(8.4);
      expect(spec.electrical?.cutoffVoltageV).toBe(6.0);
      expect(spec.electrical?.capacityMah).toBe(1500);

      // Unverified / non-fabricated specs must be undefined
      expect(spec.electrical?.continuousDischargeC).toBeUndefined();
      expect(spec.electrical?.burstDischargeC).toBeUndefined();
      expect(spec.electrical?.internalResistanceOhm).toBeUndefined();
      expect(spec.connector).toBeUndefined();

      // Provenance: generic preset without manufacturer verification
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:battery:compact-lipo");
        expect(spec.generalProvenance.notes).toContain("Generic game preset");
      }

      // Field provenance for derived/estimated properties
      expect(spec.fieldProvenance?.cellCountS?.method).toBe("estimated");
      expect(spec.fieldProvenance?.parallelCountP?.method).toBe("estimated");
      expect(spec.fieldProvenance?.["electrical.fullyChargedVoltageV"]?.method).toBe("estimated");
      expect(spec.fieldProvenance?.["electrical.cutoffVoltageV"]?.method).toBe("estimated");
    });

    it("populates authoritative engineeringSpec on Standard LiPo", () => {
      const standard = batteryCatalogue.find((b) => b.id === "standard-lipo");
      expect(standard?.engineeringSpec).toBeDefined();
      const spec = standard!.engineeringSpec!;

      expect(spec.category).toBe("battery");
      expect(spec.chemistry).toBe("lipo");
      expect(spec.cellCountS).toBe(3);
      expect(spec.parallelCountP).toBe(1);

      // Electrical specs
      expect(spec.electrical?.nominalVoltageV).toBe(11.1);
      expect(spec.electrical?.fullyChargedVoltageV).toBe(12.6);
      expect(spec.electrical?.cutoffVoltageV).toBe(9.0);
      expect(spec.electrical?.capacityMah).toBe(2200);

      // Unverified / non-fabricated specs must be undefined
      expect(spec.electrical?.continuousDischargeC).toBeUndefined();
      expect(spec.electrical?.burstDischargeC).toBeUndefined();
      expect(spec.electrical?.internalResistanceOhm).toBeUndefined();
      expect(spec.connector).toBeUndefined();

      // Provenance: generic preset without manufacturer verification
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:battery:standard-lipo");
        expect(spec.generalProvenance.notes).toContain("Generic game preset");
      }

      // Field provenance for derived/estimated properties
      expect(spec.fieldProvenance?.cellCountS?.method).toBe("estimated");
      expect(spec.fieldProvenance?.parallelCountP?.method).toBe("estimated");
      expect(spec.fieldProvenance?.["electrical.fullyChargedVoltageV"]?.method).toBe("estimated");
      expect(spec.fieldProvenance?.["electrical.cutoffVoltageV"]?.method).toBe("estimated");
    });

    it("populates authoritative engineeringSpec on Heavy Duty LiPo", () => {
      const heavy = batteryCatalogue.find((b) => b.id === "heavy-duty-lipo");
      expect(heavy?.engineeringSpec).toBeDefined();
      const spec = heavy!.engineeringSpec!;

      expect(spec.category).toBe("battery");
      expect(spec.chemistry).toBe("lipo");
      expect(spec.cellCountS).toBe(4);
      expect(spec.parallelCountP).toBe(1);

      // Electrical specs
      expect(spec.electrical?.nominalVoltageV).toBe(14.8);
      expect(spec.electrical?.fullyChargedVoltageV).toBe(16.8);
      expect(spec.electrical?.cutoffVoltageV).toBe(12.0);
      expect(spec.electrical?.capacityMah).toBe(5000);

      // Unverified / non-fabricated specs must be undefined
      expect(spec.electrical?.continuousDischargeC).toBeUndefined();
      expect(spec.electrical?.burstDischargeC).toBeUndefined();
      expect(spec.electrical?.internalResistanceOhm).toBeUndefined();
      expect(spec.connector).toBeUndefined();

      // Provenance: generic preset without manufacturer verification
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(false);
        expect(spec.generalProvenance.source).toBe("catalogue:battery:heavy-duty-lipo");
        expect(spec.generalProvenance.notes).toContain("Generic game preset");
      }

      // Field provenance for derived/estimated properties
      expect(spec.fieldProvenance?.cellCountS?.method).toBe("estimated");
      expect(spec.fieldProvenance?.parallelCountP?.method).toBe("estimated");
      expect(spec.fieldProvenance?.["electrical.fullyChargedVoltageV"]?.method).toBe("estimated");
      expect(spec.fieldProvenance?.["electrical.cutoffVoltageV"]?.method).toBe("estimated");
    });

    it("preserves resolver compatibility and non-fabrication for catalogue batteries", () => {
      const part: RobotPart = {
        id: "battery-instance-1",
        name: "Standard Battery Instance",
        type: "Battery",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.2, 0.04, 0.09],
        color: "#b45309",
        mass: 0.22,
        batteryCatalogueId: "standard-lipo",
      };

      const resolved = resolveComponentEngineeringSpec(part);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("battery");
      if (resolved?.category === "battery") {
        expect(resolved.chemistry).toBe("lipo");
        expect(resolved.cellCountS).toBe(3);
        expect(resolved.parallelCountP).toBe(1);
        expect(resolved.electrical?.nominalVoltageV).toBe(11.1);
        expect(resolved.electrical?.fullyChargedVoltageV).toBe(12.6);
        expect(resolved.electrical?.cutoffVoltageV).toBe(9.0);
        expect(resolved.electrical?.capacityMah).toBe(2200);
        expect(resolved.electrical?.continuousDischargeC).toBeUndefined();
        expect(resolved.electrical?.internalResistanceOhm).toBeUndefined();
        expect(resolved.connector).toBeUndefined();
        expect(resolved.generalProvenance?.method).toBe("datasheet");
        if (resolved.generalProvenance?.method === "datasheet") {
          expect(resolved.generalProvenance.verified).toBe(false);
        }
      }
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

    it("populates authoritative engineeringSpec on Arduino Uno", () => {
      const uno = controllerCatalogue.find((c) => c.id === "arduino-uno");
      expect(uno?.engineeringSpec).toBeDefined();
      const spec = uno!.engineeringSpec!;

      expect(spec.category).toBe("controller");
      expect(spec.controllerType).toBe("microcontroller-board");
      expect(spec.processorArchitecture).toBe("AVR (8-bit RISC)");
      expect(spec.clockSpeedHz).toBe(16_000_000);

      // Electrical specs
      expect(spec.electrical?.logicLevelV).toBe(5.0);
      expect(spec.electrical?.inputVoltageRangeV).toEqual({ minV: 7.0, maxV: 12.0 });
      expect(spec.electrical?.maxLogicRailCurrentA).toBe(0.5);
      expect(spec.electrical?.idleCurrentA).toBeUndefined(); // Deliberately undefined
      expect(spec.electrical?.provenance?.method).toBe("datasheet");
      if (spec.electrical?.provenance?.method === "datasheet") {
        expect(spec.electrical.provenance.verified).toBe(true);
      }

      // Interfaces specs
      expect(spec.interfaces?.digitalIoPins).toBe(14);
      expect(spec.interfaces?.pwmOutputs).toBe(6);
      expect(spec.interfaces?.analogInputs).toBe(6);
      expect(spec.interfaces?.supportedProtocols).toEqual(["uart", "spi", "i2c", "usb"]);
      expect(spec.interfaces?.motorChannels).toBeUndefined(); // Microcontroller, not ESC

      // Mounting
      expect(spec.mounting?.patternType).toBe("face-mount");
      expect(spec.mounting?.boltPattern?.boltSize).toBe("M3");
      expect(spec.mounting?.boltPattern?.holeCount).toBe(4);

      // General provenance
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(true);
      }

      // Provenance notes clarification checks
      expect(spec.electrical?.provenance?.notes).toContain("500mA PTC polyfuse");
      expect(spec.electrical?.provenance?.notes).toContain("thermal");
      expect(spec.electrical?.provenance?.notes).toContain("3.3V rail");
      expect(spec.generalProvenance?.notes).toContain("USB 500mA");
      expect(spec.generalProvenance?.notes).toContain("3.3V rail");
    });

    it("populates authoritative engineeringSpec on ESP32 DevKit", () => {
      const esp = controllerCatalogue.find((c) => c.id === "esp32-devkit");
      expect(esp?.engineeringSpec).toBeDefined();
      const spec = esp!.engineeringSpec!;

      expect(spec.category).toBe("controller");
      expect(spec.controllerType).toBe("microcontroller-board");
      expect(spec.processorArchitecture).toBe("Xtensa dual-core 32-bit LX6");
      expect(spec.clockSpeedHz).toBe(240_000_000);

      // Electrical specs
      expect(spec.electrical?.logicLevelV).toBe(3.3);
      expect(spec.electrical?.inputVoltageRangeV).toEqual({ minV: 4.5, maxV: 5.5 });
      expect(spec.electrical?.maxLogicRailCurrentA).toBe(0.5);
      expect(spec.electrical?.idleCurrentA).toBeUndefined();
      expect(spec.electrical?.provenance?.method).toBe("datasheet");
      if (spec.electrical?.provenance?.method === "datasheet") {
        expect(spec.electrical.provenance.verified).toBe(true);
      }

      // Interfaces specs
      expect(spec.interfaces?.digitalIoPins).toBe(28);
      expect(spec.interfaces?.pwmOutputs).toBe(16);
      expect(spec.interfaces?.analogInputs).toBe(16); // Corrected from 18 to 16 accessible ADC channels
      expect(spec.interfaces?.supportedProtocols).toContain("wifi");
      expect(spec.interfaces?.supportedProtocols).toContain("bluetooth");
      expect(spec.interfaces?.supportedProtocols).toContain("can");
      expect(spec.interfaces?.motorChannels).toBeUndefined();

      // ESP32 breadboard-friendly devkit lacks dedicated bolt pattern
      expect(spec.mounting).toBeUndefined();

      // General provenance
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(true);
      }

      // Provenance notes clarification checks
      expect(spec.generalProvenance?.notes).toContain("input-only");
      expect(spec.generalProvenance?.notes).toContain("strapping pins");
      expect(spec.generalProvenance?.notes).toContain("ADC2");
      expect(spec.generalProvenance?.notes).toContain("transceiver");
    });

    it("populates authoritative engineeringSpec on STM32 Nucleo", () => {
      const stm = controllerCatalogue.find((c) => c.id === "stm32-nucleo");
      expect(stm?.engineeringSpec).toBeDefined();
      const spec = stm!.engineeringSpec!;

      expect(spec.category).toBe("controller");
      expect(spec.controllerType).toBe("microcontroller-board");
      expect(spec.processorArchitecture).toBe("Arm Cortex-M4 (32-bit with FPU)");
      expect(spec.clockSpeedHz).toBe(84_000_000);

      // Electrical specs
      expect(spec.electrical?.logicLevelV).toBe(3.3);
      expect(spec.electrical?.inputVoltageRangeV).toEqual({ minV: 7.0, maxV: 12.0 });
      expect(spec.electrical?.maxLogicRailCurrentA).toBe(0.5);
      expect(spec.electrical?.idleCurrentA).toBeUndefined();
      expect(spec.electrical?.provenance?.method).toBe("datasheet");
      if (spec.electrical?.provenance?.method === "datasheet") {
        expect(spec.electrical.provenance.verified).toBe(true);
      }

      // Interfaces specs - verified STM32F401RE has no hardware CAN peripheral
      expect(spec.interfaces?.digitalIoPins).toBe(50);
      expect(spec.interfaces?.pwmOutputs).toBe(16);
      expect(spec.interfaces?.analogInputs).toBe(16);
      expect(spec.interfaces?.supportedProtocols).toEqual(["uart", "spi", "i2c", "usb", "pwm"]);
      expect(spec.interfaces?.supportedProtocols).not.toContain("can");
      expect(spec.interfaces?.motorChannels).toBeUndefined();

      // General provenance
      expect(spec.generalProvenance?.method).toBe("datasheet");
      if (spec.generalProvenance?.method === "datasheet") {
        expect(spec.generalProvenance.verified).toBe(true);
      }

      // Provenance notes clarification checks
      expect(spec.generalProvenance?.notes).toContain("Morpho");
      expect(spec.generalProvenance?.notes).toContain("Arduino headers");
      expect(spec.generalProvenance?.notes).toContain("ST-LINK");
      expect(spec.generalProvenance?.notes).toContain("breakout");
    });
  });
});
