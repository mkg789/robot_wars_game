import { describe, expect, it } from "vitest";
import {
  resolveComponentEngineeringSpec,
  resolveMotorEngineeringSpec,
  resolveWheelEngineeringSpec,
  resolveBatteryEngineeringSpec,
  resolveControllerEngineeringSpec,
  resolveStructuralEngineeringSpec,
} from "./engineeringAdapters";
import type {
  RobotPart,
  MotorDefinition,
  ProvenanceMeta,
} from "../types/robot.types";
import type { FoundationModel } from "../data/foundationModels";

describe("Phase 3.2 — Engineering Specification Resolver / Adapter", () => {
  describe("Precedence Tier 1: Runtime Engineering Specifications", () => {
    it("ensures runtime engineeringSpec overrides catalogue and legacy specifications", () => {
      const partWithRuntimeSpec: RobotPart = {
        id: "motor-test-1",
        name: "Customized High-Speed Motor",
        type: "Motor",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.38, 0.34, 0.42],
        color: "#f97316",
        mass: 0.48,
        motorCatalogueId: "standard-dc", // Standard DC in catalogue has torque 0.8, rpm 150
        mechanical: {
          stallTorqueNm: 0.8,
          noLoadRpm: 150,
        },
        engineeringSpec: {
          category: "motor",
          technology: "brushless-dc-sensorless",
          electrical: {
            nominalVoltageV: 24.0,
            stallCurrentA: 40.0,
          },
          mechanical: {
            stallTorqueNm: 3.5, // Custom rewound motor with 3.5 Nm
            noLoadSpeedRpm: 12000,
          },
          generalProvenance: {
            method: "measured",
            verified: true,
            source: "In-house dynamometer run #88",
          },
        },
      };

      const resolved = resolveComponentEngineeringSpec(partWithRuntimeSpec);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("motor");

      if (resolved?.category === "motor") {
        // Runtime specification took precedence
        expect(resolved.technology).toBe("brushless-dc-sensorless");
        expect(resolved.electrical?.nominalVoltageV).toBe(24.0);
        expect(resolved.electrical?.stallCurrentA).toBe(40.0);
        expect(resolved.mechanical?.stallTorqueNm).toBe(3.5);
        expect(resolved.mechanical?.noLoadSpeedRpm).toBe(12000);
        expect(resolved.generalProvenance?.method).toBe("measured");
        if (resolved.generalProvenance?.method === "measured") {
          expect(resolved.generalProvenance.source).toBe("In-house dynamometer run #88");
        }
      }
    });

    it("falls back to catalogue specs for fields unspecified in partial runtime spec", () => {
      const partialRuntimePart: RobotPart = {
        id: "motor-test-2",
        name: "Standard Motor with Voltage Tweak",
        type: "Motor",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.38, 0.34, 0.42],
        color: "#f97316",
        mass: 0.48,
        motorCatalogueId: "standard-dc", // Has torque 0.8, rpm 150
        engineeringSpec: {
          category: "motor",
          electrical: {
            nominalVoltageV: 18.0, // Only electrical voltage customized
          },
        },
      };

      const resolved = resolveMotorEngineeringSpec(partialRuntimePart);
      // Customized voltage
      expect(resolved.electrical?.nominalVoltageV).toBe(18.0);
      // Fallback mechanical from catalogue
      expect(resolved.mechanical?.stallTorqueNm).toBe(0.8);
      expect(resolved.mechanical?.noLoadSpeedRpm).toBe(150);
    });
  });

  describe("Precedence Tier 2: Catalogue Engineering Specifications", () => {
    it("utilizes catalogue engineeringSpec when runtime spec is absent", () => {
      const mockCatalogueMotor: MotorDefinition = {
        id: "standard-dc",
        name: "Standard DC Motor",
        description: "Test motor with cat spec",
        dimensions: [0.38, 0.34, 0.42],
        weight: 0.48,
        rpm: 150,
        torque: 0.8,
        mountingFootprint: [0.54, 0.42],
        color: "#f97316",
        geometry: { shape: "box", length: 0.38, height: 0.34, width: 0.42 },
        massKg: 0.48,
        mechanical: { stallTorqueNm: 0.8, noLoadRpm: 150 },
        engineeringSpec: {
          category: "motor",
          technology: "brushed-dc",
          electrical: {
            nominalVoltageV: 12.0,
            stallCurrentA: 14.5,
            provenance: {
              method: "datasheet",
              verified: true,
              source: "Manufacturer specification sheet 2025",
            },
          },
          mechanical: {
            stallTorqueNm: 0.82,
            noLoadSpeedRpm: 152,
            gearRatio: 19.5,
          },
          shaft: {
            profile: "d-shaft",
            diameterM: 0.004,
            lengthM: 0.015,
          },
        },
      };

      const runtimePart: RobotPart = {
        id: "motor-test-3",
        name: "Standard Motor Instance",
        type: "Motor",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.38, 0.34, 0.42],
        color: "#f97316",
        mass: 0.48,
        motorCatalogueId: "standard-dc",
        // No runtime engineeringSpec
      };

      const resolved = resolveMotorEngineeringSpec(runtimePart, mockCatalogueMotor);
      expect(resolved.electrical?.nominalVoltageV).toBe(12.0);
      expect(resolved.electrical?.stallCurrentA).toBe(14.5);
      expect(resolved.electrical?.provenance?.method).toBe("datasheet");
      expect(resolved.mechanical?.stallTorqueNm).toBe(0.82);
      expect(resolved.mechanical?.gearRatio).toBe(19.5);
      expect(resolved.shaft?.profile).toBe("d-shaft");
      expect(resolved.shaft?.diameterM).toBe(0.004);
    });
  });

  describe("Precedence Tier 3: Legacy Property Adaptation", () => {
    it("adapts legacy motor properties when no engineeringSpec exists", () => {
      const legacyMotorPart: RobotPart = {
        id: "motor-legacy-1",
        name: "Small DC Gear Motor",
        type: "Motor",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.28, 0.26, 0.34],
        color: "#ef4444",
        mass: 0.22,
        motorCatalogueId: "small-dc",
        mechanical: {
          stallTorqueNm: 0.35,
          noLoadRpm: 180,
        },
      };

      const resolved = resolveComponentEngineeringSpec(legacyMotorPart);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("motor");

      if (resolved?.category === "motor") {
        expect(resolved.mechanical?.stallTorqueNm).toBe(0.35);
        expect(resolved.mechanical?.noLoadSpeedRpm).toBe(180);
        expect(resolved.mechanical?.provenance?.method).toBe("datasheet");
        expect(resolved.generalProvenance?.method).toBe("datasheet");
      }
    });

    it("adapts legacy wheel properties without fabricating fake hub or friction values", () => {
      const legacyWheelPart: RobotPart = {
        id: "wheel-legacy-1",
        name: "Standard Rubber Wheel",
        type: "Wheel",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.07, 0.22, 0.22],
        color: "#20242b",
        mass: 0.16,
        wheelCatalogueId: "standard-rubber",
        wheelDiameter: 0.22,
        wheelWidth: 0.07,
      };

      const resolved = resolveComponentEngineeringSpec(legacyWheelPart);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("wheel");

      if (resolved?.category === "wheel") {
        expect(resolved.treadType).toBe("rubber");
        // Crucial: no fabricated numbers for unknown hub and traction
        expect(resolved.hub).toBeUndefined();
        expect(resolved.traction).toBeUndefined();
        expect(resolved.generalProvenance?.method).toBe("datasheet");
      }
    });

    it("adapts legacy battery properties and infers series cell count for LiPo", () => {
      const legacyBatteryPart: RobotPart = {
        id: "battery-legacy-1",
        name: "Standard LiPo 3S",
        type: "Battery",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.2, 0.04, 0.09],
        color: "#b45309",
        mass: 0.22,
        batteryCatalogueId: "standard-lipo",
        electrical: {
          nominalVoltageV: 11.1,
          capacityMah: 2200,
        },
      };

      const resolved = resolveComponentEngineeringSpec(legacyBatteryPart);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("battery");

      if (resolved?.category === "battery") {
        expect(resolved.chemistry).toBe("lipo");
        expect(resolved.cellCountS).toBe(3); // 11.1V / 3.7V = 3S
        expect(resolved.electrical?.nominalVoltageV).toBe(11.1);
        expect(resolved.electrical?.capacityMah).toBe(2200);
        // Crucial: no fabricated C-rating or internal resistance
        expect(resolved.electrical?.continuousDischargeC).toBeUndefined();
        expect(resolved.electrical?.internalResistanceOhm).toBeUndefined();
        expect(resolved.generalProvenance?.method).toBe("datasheet");
      }
    });

    it("adapts legacy controller properties and parses operating voltage", () => {
      const legacyControllerPart: RobotPart = {
        id: "ctrl-legacy-1",
        name: "Arduino Uno",
        type: "Controller",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.069, 0.015, 0.054],
        color: "#177e89",
        mass: 0.025,
        controllerCatalogueId: "arduino-uno",
        electrical: {
          nominalVoltageV: 5.0,
        },
      };

      const resolved = resolveComponentEngineeringSpec(legacyControllerPart);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("controller");

      if (resolved?.category === "controller") {
        expect(resolved.controllerType).toBe("microcontroller-board");
        expect(resolved.processorArchitecture).toBe("ATmega328P");
        expect(resolved.clockSpeedHz).toBe(16_000_000);
        expect(resolved.electrical?.logicLevelV).toBe(5.0);
        // Crucial: no fabricated input voltage range
        expect(resolved.electrical?.inputVoltageRangeV).toBeUndefined();
        expect(resolved.generalProvenance?.method).toBe("datasheet");
      }
    });

    it("adapts legacy structural block and armor plate without fabricating material", () => {
      const armorPart: RobotPart = {
        id: "armor-plate-1",
        name: "Front Armor 4mm",
        type: "Armor Plate",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.004, 0.25, 0.4],
        color: "#475569",
        mass: 0.85,
        geometry: {
          shape: "box",
          length: 0.004,
          height: 0.25,
          width: 0.4,
        },
      };

      const resolved = resolveComponentEngineeringSpec(armorPart);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("structural");

      if (resolved?.category === "structural") {
        expect(resolved.role).toBe("armor-plate");
        expect(resolved.plateThicknessM).toBe(0.004);
        // Crucial: no fabricated material density or yield strength
        expect(resolved.material).toBeUndefined();
        expect(resolved.generalProvenance?.method).toBe("estimated");
        if (resolved.generalProvenance?.method === "estimated") {
          expect(resolved.generalProvenance.basis).toBeDefined();
        }
      }
    });
  });

  describe("Refinement 1: Provenance Discriminated Union", () => {
    it("distinguishes datasheet, measured, estimated, and unknown with compile-time type safety", () => {
      const datasheetProv: ProvenanceMeta = {
        method: "datasheet",
        verified: true,
        source: "https://example.com/spec.pdf",
      };

      const measuredProv: ProvenanceMeta = {
        method: "measured",
        verified: true,
        source: "Bench dyno report #102",
      };

      const estimatedProv: ProvenanceMeta = {
        method: "estimated",
        basis: "Calculated via gear ratio and motor back-EMF",
      };

      const unknownProv: ProvenanceMeta = {
        method: "unknown",
        notes: "Pending vendor clarification",
      };

      expect(datasheetProv.method).toBe("datasheet");
      expect(datasheetProv.source).toBe("https://example.com/spec.pdf");
      expect(measuredProv.method).toBe("measured");
      expect(measuredProv.verified).toBe(true);
      expect(estimatedProv.method).toBe("estimated");
      expect(estimatedProv.basis).toContain("gear ratio");
      expect(unknownProv.method).toBe("unknown");
    });
  });

  describe("Refinement 2: Partial Specs & Non-Fabrication of Unknowns", () => {
    it("cleanly handles completely unknown motors without inventing numbers", () => {
      const blankMotorPart: RobotPart = {
        id: "motor-unknown-1",
        name: "Unknown Motor From Imported Model",
        type: "Motor",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.3, 0.3, 0.3],
        color: "#333",
        mass: 0.5,
        // No catalogue id, no electrical, no mechanical, no engineeringSpec
      };

      const resolved = resolveMotorEngineeringSpec(blankMotorPart);
      expect(resolved.category).toBe("motor");
      expect(resolved.technology).toBeUndefined();
      expect(resolved.electrical).toBeUndefined();
      expect(resolved.mechanical).toBeUndefined();
      expect(resolved.shaft).toBeUndefined();
      expect(resolved.mounting).toBeUndefined();
      expect(resolved.generalProvenance?.method).toBe("unknown");
    });

    it("cleanly handles completely unknown wheels without inventing numbers", () => {
      const blankWheelPart: RobotPart = {
        id: "wheel-unknown-1",
        name: "Unknown Wheel",
        type: "Wheel",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.1, 0.2, 0.2],
        color: "#333",
        mass: 0.2,
      };

      const resolved = resolveWheelEngineeringSpec(blankWheelPart);
      expect(resolved.category).toBe("wheel");
      expect(resolved.treadType).toBeUndefined();
      expect(resolved.hub).toBeUndefined();
      expect(resolved.traction).toBeUndefined();
      expect(resolved.generalProvenance?.method).toBe("unknown");
    });

    it("cleanly handles completely unknown batteries without inventing numbers", () => {
      const blankBatteryPart: RobotPart = {
        id: "battery-unknown-1",
        name: "Unknown Battery",
        type: "Battery",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.1, 0.05, 0.05],
        color: "#333",
        mass: 0.3,
      };

      const resolved = resolveBatteryEngineeringSpec(blankBatteryPart);
      expect(resolved.category).toBe("battery");
      expect(resolved.chemistry).toBeUndefined();
      expect(resolved.cellCountS).toBeUndefined();
      expect(resolved.electrical).toBeUndefined();
      expect(resolved.generalProvenance?.method).toBe("unknown");
    });

    it("cleanly handles completely unknown controllers without inventing numbers", () => {
      const blankControllerPart: RobotPart = {
        id: "ctrl-unknown-1",
        name: "Unknown Controller Board",
        type: "Controller",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.05, 0.01, 0.05],
        color: "#333",
        mass: 0.02,
      };

      const resolved = resolveControllerEngineeringSpec(blankControllerPart);
      expect(resolved.category).toBe("controller");
      expect(resolved.controllerType).toBeUndefined();
      expect(resolved.processorArchitecture).toBeUndefined();
      expect(resolved.clockSpeedHz).toBeUndefined();
      expect(resolved.electrical).toBeUndefined();
      expect(resolved.generalProvenance?.method).toBe("unknown");
    });
  });

  describe("Regression Safety & Edge Cases", () => {
    it("returns undefined for unrecognized part types without engineering spec", () => {
      const unknownPart = {
        id: "sensor-1",
        name: "Ultrasonic Sensor",
        type: "CustomSensor" as unknown as RobotPart["type"],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.1, 0.1, 0.1],
        color: "#fff",
        mass: 0.05,
      } as RobotPart;

      const resolved = resolveComponentEngineeringSpec(unknownPart);
      expect(resolved).toBeUndefined();
    });

    it("respects runtime engineeringSpec.category even if part.type does not match", () => {
      const customPart: RobotPart = {
        id: "custom-actuator",
        name: "Linear Actuator",
        type: "Structural Block", // Legacy type says Structural Block
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.1, 0.1, 0.5],
        color: "#999",
        mass: 1.2,
        engineeringSpec: {
          category: "motor", // User explicitly classified as motor
          technology: "brushed-dc",
          mechanical: {
            stallTorqueNm: 5.0,
            noLoadSpeedRpm: 60,
          },
        },
      };

      const resolved = resolveComponentEngineeringSpec(customPart);
      expect(resolved?.category).toBe("motor");
      if (resolved?.category === "motor") {
        expect(resolved.mechanical?.stallTorqueNm).toBe(5.0);
      }
    });

    it("resolves foundation model chassis engineering specifications", () => {
      const foundationPart: RobotPart = {
        id: "compact-square",
        name: "Compact Square",
        type: "Structural Block",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [1.6, 0.28, 1.4],
        color: "#334155",
        mass: 15.0,
      };

      const foundationModel: FoundationModel = {
        id: "compact-square",
        name: "Compact Square",
        description: "Small chassis",
        length: 1.6,
        width: 1.4,
        height: 0.28,
        icon: "▣",
        geometry: { shape: "box", length: 1.6, height: 0.28, width: 1.4 },
        engineeringSpec: {
          category: "structural",
          role: "chassis-frame",
          material: {
            material: "aluminum-6061-t6",
            densityKgM3: 2700,
            yieldStrengthPa: 276e6,
          },
        },
      };

      const resolved = resolveStructuralEngineeringSpec(foundationPart, foundationModel);
      expect(resolved.category).toBe("structural");
      expect(resolved.role).toBe("chassis-frame");
      expect(resolved.material?.material).toBe("aluminum-6061-t6");
      expect(resolved.material?.densityKgM3).toBe(2700);
    });
  });
});
