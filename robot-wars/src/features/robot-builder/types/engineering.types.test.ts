import { describe, expect, it } from "vitest";
import type {
  ComponentEngineeringSpec,
  MotorEngineeringSpec,
  WheelEngineeringSpec,
  BatteryEngineeringSpec,
  ControllerEngineeringSpec,
  StructuralEngineeringSpec,
  ProvenanceMeta,
  ShaftInterface,
  HubInterface,
  MountingInterface,
  RobotPart,
  MotorDefinition,
  WheelDefinition,
  BatteryDefinition,
  ControllerDefinition,
} from "./robot.types";
import type { FoundationModel } from "../data/foundationModels";

describe("Phase 3.1 — Engineering Specification Types", () => {
  describe("Discriminated Union & Category Integrity", () => {
    it("exhaustively discriminates all supported component categories", () => {
      const getCategoryLabel = (spec: ComponentEngineeringSpec): string => {
        switch (spec.category) {
          case "motor":
            return `Motor (${spec.technology})`;
          case "wheel":
            return `Wheel (${spec.treadType})`;
          case "battery":
            return `Battery (${spec.chemistry})`;
          case "controller":
            return `Controller (${spec.controllerType})`;
          case "structural":
            return `Structural (${spec.material.material})`;
          default: {
            const _exhaustiveCheck: never = spec;
            return _exhaustiveCheck;
          }
        }
      };

      const motorSpec: MotorEngineeringSpec = {
        category: "motor",
        technology: "brushed-dc",
        electrical: { nominalVoltageV: 12.0 },
        mechanical: { stallTorqueNm: 0.8, noLoadSpeedRpm: 150 },
        shaft: { profile: "d-shaft", diameterM: 0.004, lengthM: 0.015 },
      };

      const wheelSpec: WheelEngineeringSpec = {
        category: "wheel",
        treadType: "rubber",
        hub: { profile: "d-shaft", boreDiameterM: 0.004, engagementDepthM: 0.012 },
        traction: { staticFrictionCoeff: 0.85 },
      };

      const batterySpec: BatteryEngineeringSpec = {
        category: "battery",
        chemistry: "lipo",
        cellCountS: 3,
        electrical: { nominalVoltageV: 11.1, capacityMah: 2200 },
      };

      const controllerSpec: ControllerEngineeringSpec = {
        category: "controller",
        controllerType: "microcontroller-board",
        electrical: { logicLevelV: 5.0, inputVoltageRangeV: { minV: 7.0, maxV: 12.0 } },
        interfaces: { digitalIoPins: 14, pwmOutputs: 6 },
      };

      const structuralSpec: StructuralEngineeringSpec = {
        category: "structural",
        material: { material: "aluminum-6061-t6", densityKgM3: 2700 },
        plateThicknessM: 0.003,
      };

      expect(getCategoryLabel(motorSpec)).toBe("Motor (brushed-dc)");
      expect(getCategoryLabel(wheelSpec)).toBe("Wheel (rubber)");
      expect(getCategoryLabel(batterySpec)).toBe("Battery (lipo)");
      expect(getCategoryLabel(controllerSpec)).toBe("Controller (microcontroller-board)");
      expect(getCategoryLabel(structuralSpec)).toBe("Structural (aluminum-6061-t6)");
    });
  });

  describe("Specification Provenance Architecture", () => {
    it("distinguishes datasheet, measured, estimated, and unknown veracity", () => {
      const datasheetProv: ProvenanceMeta = {
        method: "datasheet",
        verified: true,
        source: "https://example.com/datasheets/rs-540.pdf",
      };

      const measuredProv: ProvenanceMeta = {
        method: "measured",
        verified: true,
        source: "Laboratory bench dyno test run #42",
        notes: "Tested at 12.0V regulated bench supply, 23°C ambient",
      };

      const estimatedProv: ProvenanceMeta = {
        method: "estimated",
        verified: false,
        basis: "Theoretical back-EMF formula Kv = 1 / Ke",
      };

      const unknownProv: ProvenanceMeta = {
        method: "unknown",
        verified: false,
        notes: "Pending manufacturer response",
      };

      expect(datasheetProv.method).toBe("datasheet");
      expect(datasheetProv.verified).toBe(true);
      expect(measuredProv.method).toBe("measured");
      expect(estimatedProv.method).toBe("estimated");
      expect(estimatedProv.basis).toBeDefined();
      expect(unknownProv.method).toBe("unknown");
      expect(unknownProv.verified).toBe(false);
    });

    it("allows distinct fields on the same component to have different provenance", () => {
      const motor: MotorEngineeringSpec = {
        category: "motor",
        technology: "brushed-dc",
        electrical: {
          nominalVoltageV: 12.0,
          noLoadCurrentA: 0.45,
          stallCurrentA: 15.0,
          terminalResistanceOhm: 0.8,
          provenance: {
            method: "datasheet",
            verified: true,
            source: "Mabuchi Motor Datasheet 2024",
          },
        },
        mechanical: {
          stallTorqueNm: 0.35,
          noLoadSpeedRpm: 18000,
          gearRatio: 20.0,
          gearboxEfficiency: 0.82,
          provenance: {
            method: "measured",
            verified: true,
            source: "In-house dynamometer test",
          },
        },
        shaft: {
          profile: "d-shaft",
          diameterM: 0.004,
          lengthM: 0.012,
        },
        fieldProvenance: {
          // Gearbox efficiency was estimated via heuristic, while the rest was measured
          gearboxEfficiency: {
            method: "estimated",
            verified: false,
            basis: "Standard 2-stage planetary spur gear loss (9% per stage)",
          },
          // Thermal limit is unknown
          thermalLimits: {
            method: "unknown",
            verified: false,
            notes: "No thermal testing performed yet",
          },
        },
      };

      expect(motor.electrical.provenance?.method).toBe("datasheet");
      expect(motor.mechanical.provenance?.method).toBe("measured");
      expect(motor.fieldProvenance?.gearboxEfficiency?.method).toBe("estimated");
      expect(motor.fieldProvenance?.thermalLimits?.method).toBe("unknown");
    });

    it("does not force numerical fabrication for unknown specifications", () => {
      const basicMotor: MotorEngineeringSpec = {
        category: "motor",
        technology: "brushed-dc",
        electrical: {
          nominalVoltageV: 6.0,
          // stallCurrentA, ratedCurrentA, terminalResistanceOhm are intentionally omitted / unknown
        },
        mechanical: {
          stallTorqueNm: 0.2,
          noLoadSpeedRpm: 120,
          // ratedTorqueNm, ratedSpeedRpm, gearboxEfficiency are omitted
        },
        shaft: {
          profile: "round",
          diameterM: 0.003,
          lengthM: 0.01,
        },
      };

      expect(basicMotor.electrical.stallCurrentA).toBeUndefined();
      expect(basicMotor.mechanical.ratedTorqueNm).toBeUndefined();
      expect(basicMotor.mechanical.gearboxEfficiency).toBeUndefined();
    });
  });

  describe("Motor Engineering Specifications", () => {
    it("strictly separates stall, continuous/rated, and no-load operating values", () => {
      const motorSpec: MotorEngineeringSpec = {
        category: "motor",
        technology: "brushless-dc-sensorless",
        electrical: {
          nominalVoltageV: 24.0,
          minVoltageV: 18.0,
          maxVoltageV: 28.0,
          noLoadCurrentA: 1.2,
          ratedCurrentA: 18.0,
          stallCurrentA: 65.0,
          terminalResistanceOhm: 0.12,
        },
        mechanical: {
          stallTorqueNm: 2.5,
          ratedTorqueNm: 0.75,
          noLoadSpeedRpm: 12000,
          ratedSpeedRpm: 9500,
          gearRatio: 1.0,
          gearboxEfficiency: 1.0,
        },
        shaft: {
          profile: "round",
          diameterM: 0.005,
          lengthM: 0.02,
        },
      };

      // Distinct torque values
      expect(motorSpec.mechanical.stallTorqueNm).toBe(2.5);
      expect(motorSpec.mechanical.ratedTorqueNm).toBe(0.75);
      expect(motorSpec.mechanical.stallTorqueNm).not.toBe(motorSpec.mechanical.ratedTorqueNm);

      // Distinct speed values
      expect(motorSpec.mechanical.noLoadSpeedRpm).toBe(12000);
      expect(motorSpec.mechanical.ratedSpeedRpm).toBe(9500);
      expect(motorSpec.mechanical.noLoadSpeedRpm).toBeGreaterThan(motorSpec.mechanical.ratedSpeedRpm!);

      // Distinct current values
      expect(motorSpec.electrical.noLoadCurrentA).toBe(1.2);
      expect(motorSpec.electrical.ratedCurrentA).toBe(18.0);
      expect(motorSpec.electrical.stallCurrentA).toBe(65.0);
      expect(motorSpec.electrical.stallCurrentA).toBeGreaterThan(motorSpec.electrical.ratedCurrentA!);
      expect(motorSpec.electrical.ratedCurrentA).toBeGreaterThan(motorSpec.electrical.noLoadCurrentA!);
    });
  });

  describe("Mechanical Interface Contracts", () => {
    it("models detailed shaft geometry in canonical meters", () => {
      const dShaft: ShaftInterface = {
        identifier: "shaft-front-output",
        profile: "d-shaft",
        diameterM: 0.006, // 6mm
        lengthM: 0.025, // 25mm
        flatDepthM: 0.0005, // 0.5mm flat cut
      };

      const hexShaft: ShaftInterface = {
        identifier: "shaft-hex-axle",
        profile: "hex",
        diameterM: 0.012, // 12mm hex
        lengthM: 0.05,
      };

      expect(dShaft.profile).toBe("d-shaft");
      expect(dShaft.diameterM).toBe(0.006);
      expect(dShaft.flatDepthM).toBe(0.0005);
      expect(hexShaft.profile).toBe("hex");
    });

    it("models hub interfaces with retention mechanisms", () => {
      const wheelHub: HubInterface = {
        identifier: "hub-wheel-core",
        profile: "d-shaft",
        boreDiameterM: 0.006,
        engagementDepthM: 0.018,
        retentionType: "set-screw",
        fastenerSpec: "M3x0.5 cup point",
      };

      expect(wheelHub.profile).toBe("d-shaft");
      expect(wheelHub.boreDiameterM).toBe(0.006);
      expect(wheelHub.retentionType).toBe("set-screw");
    });

    it("models structural mounting patterns and bolt circles", () => {
      const faceMount: MountingInterface = {
        identifier: "mount-motor-face",
        patternType: "face-mount",
        boltPattern: {
          boltSize: "M3",
          holeCount: 4,
          boltCircleDiameterM: 0.025, // 25mm BCD
          maxThreadDepthM: 0.006,
        },
        pilotDiameterM: 0.012, // 12mm centering boss
        footprintDimensionsM: [0.038, 0.038, 0.045],
      };

      expect(faceMount.patternType).toBe("face-mount");
      expect(faceMount.boltPattern?.holeCount).toBe(4);
      expect(faceMount.boltPattern?.boltCircleDiameterM).toBe(0.025);
      expect(faceMount.pilotDiameterM).toBe(0.012);
    });
  });

  describe("Category-Specific Specifications", () => {
    it("models wheel traction and load capacities", () => {
      const wheelSpec: WheelEngineeringSpec = {
        category: "wheel",
        treadType: "polyurethane",
        hub: {
          profile: "hex",
          boreDiameterM: 0.012,
          engagementDepthM: 0.015,
          retentionType: "nut",
        },
        traction: {
          staticFrictionCoeff: 0.95,
          dynamicFrictionCoeff: 0.75,
          maxRadialLoadKg: 25.0,
          durometer: "60A",
        },
      };

      expect(wheelSpec.category).toBe("wheel");
      expect(wheelSpec.traction.staticFrictionCoeff).toBe(0.95);
      expect(wheelSpec.traction.maxRadialLoadKg).toBe(25.0);
    });

    it("models battery chemistry, cell configuration, and C-ratings", () => {
      const batterySpec: BatteryEngineeringSpec = {
        category: "battery",
        chemistry: "lipo",
        cellCountS: 4,
        parallelCountP: 1,
        electrical: {
          nominalVoltageV: 14.8,
          fullyChargedVoltageV: 16.8,
          cutoffVoltageV: 12.8,
          capacityMah: 5000,
          continuousDischargeC: 60,
          burstDischargeC: 120,
          internalResistanceOhm: 0.015,
        },
        connector: {
          type: "xt90",
          ratedCurrentA: 90.0,
        },
      };

      expect(batterySpec.cellCountS).toBe(4);
      expect(batterySpec.electrical.continuousDischargeC).toBe(60);
      expect(batterySpec.electrical.burstDischargeC).toBe(120);
      expect(batterySpec.connector?.type).toBe("xt90");
    });

    it("models controller protocols, pinouts, and power boundaries", () => {
      const controllerSpec: ControllerEngineeringSpec = {
        category: "controller",
        controllerType: "microcontroller-board",
        processorArchitecture: "ARM Cortex-M4",
        clockSpeedHz: 84000000,
        electrical: {
          logicLevelV: 3.3,
          inputVoltageRangeV: { minV: 7.0, maxV: 15.0 },
          idleCurrentA: 0.04,
          maxLogicRailCurrentA: 0.5,
        },
        interfaces: {
          digitalIoPins: 51,
          pwmOutputs: 16,
          analogInputs: 16,
          supportedProtocols: ["uart", "spi", "i2c", "can"],
        },
      };

      expect(controllerSpec.electrical.logicLevelV).toBe(3.3);
      expect(controllerSpec.interfaces.supportedProtocols).toContain("can");
      expect(controllerSpec.clockSpeedHz).toBe(84000000);
    });

    it("models structural material properties and yield strengths", () => {
      const armorSpec: StructuralEngineeringSpec = {
        category: "structural",
        role: "armor-plate",
        plateThicknessM: 0.004, // 4mm
        material: {
          material: "steel-hardox-450",
          densityKgM3: 7850,
          yieldStrengthPa: 1200000000, // 1200 MPa
          ultimateStrengthPa: 1400000000, // 1400 MPa
          hardness: "Brinell 450",
        },
      };

      expect(armorSpec.role).toBe("armor-plate");
      expect(armorSpec.plateThicknessM).toBe(0.004);
      expect(armorSpec.material.yieldStrengthPa).toBe(1.2e9);
    });
  });

  describe("RobotPart Integration & Legacy Compatibility", () => {
    it("allows legacy RobotPart instances without engineeringSpec", () => {
      const legacyPart: RobotPart = {
        id: "legacy-block-1",
        name: "Legacy Chassis Block",
        type: "Structural Block",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [2, 0.4, 1.5],
        color: "#334155",
        mass: 12.0,
      };

      expect(legacyPart.engineeringSpec).toBeUndefined();
      expect(legacyPart.size).toEqual([2, 0.4, 1.5]);
      expect(legacyPart.mass).toBe(12.0);
    });

    it("integrates engineeringSpec additively alongside canonical geometry and legacy fields", () => {
      const motorPart: RobotPart = {
        id: "drive-motor-left",
        name: "Left Drive Motor",
        type: "Motor",
        position: [-0.8, 0.2, 0.5],
        rotation: [0, 0, 0],
        size: [0.38, 0.34, 0.42],
        color: "#ef4444",
        mass: 0.48,
        geometry: {
          shape: "box",
          length: 0.38,
          height: 0.34,
          width: 0.42,
        },
        massKg: 0.48,
        mechanical: {
          stallTorqueNm: 0.8,
          noLoadRpm: 150,
        },
        engineeringSpec: {
          category: "motor",
          technology: "brushed-dc",
          electrical: {
            nominalVoltageV: 12.0,
            noLoadCurrentA: 0.3,
            stallCurrentA: 9.8,
          },
          mechanical: {
            stallTorqueNm: 0.8,
            noLoadSpeedRpm: 150,
            gearRatio: 19.5,
            gearboxEfficiency: 0.85,
          },
          shaft: {
            profile: "d-shaft",
            diameterM: 0.004,
            lengthM: 0.015,
          },
        },
      };

      expect(motorPart.engineeringSpec).toBeDefined();
      expect(motorPart.engineeringSpec?.category).toBe("motor");
      if (motorPart.engineeringSpec?.category === "motor") {
        expect(motorPart.engineeringSpec.electrical.stallCurrentA).toBe(9.8);
        expect(motorPart.engineeringSpec.mechanical.gearRatio).toBe(19.5);
      }
      expect(motorPart.geometry?.shape).toBe("box");
      expect(motorPart.massKg).toBe(0.48);
      expect(motorPart.size).toEqual([0.38, 0.34, 0.42]);
    });

    it("integrates engineeringSpec optionally into catalogue definition types", () => {
      const motorDef: MotorDefinition = {
        id: "standard-dc",
        name: "Standard DC Motor",
        description: "General purpose drive motor",
        dimensions: [0.38, 0.34, 0.42],
        weight: 0.48,
        rpm: 150,
        torque: 0.8,
        mountingFootprint: [0.54, 0.42],
        color: "#f97316",
        geometry: {
          shape: "box",
          length: 0.38,
          height: 0.34,
          width: 0.42,
        },
        massKg: 0.48,
        mechanical: {
          stallTorqueNm: 0.8,
          noLoadRpm: 150,
        },
        engineeringSpec: {
          category: "motor",
          technology: "brushed-dc",
          electrical: {
            nominalVoltageV: 12.0,
          },
          mechanical: {
            stallTorqueNm: 0.8,
            noLoadSpeedRpm: 150,
          },
          shaft: {
            profile: "d-shaft",
            diameterM: 0.004,
            lengthM: 0.015,
          },
        },
      };

      const wheelDef: WheelDefinition = {
        id: "standard-rubber",
        name: "Standard Rubber Wheel",
        description: "Versatile rubber tire",
        diameter: 0.22,
        width: 0.07,
        weight: 0.16,
        category: "Rubber",
        color: "#20242b",
        compatibleMotorIds: ["small-dc", "standard-dc"],
        geometry: {
          shape: "cylinder",
          diameter: 0.22,
          axialWidth: 0.07,
          axis: "x",
        },
        massKg: 0.16,
      };

      const batteryDef: BatteryDefinition = {
        id: "standard-lipo",
        name: "Standard LiPo",
        chemistry: "LiPo",
        voltage: 11.1,
        capacityMah: 2200,
        dimensions: { length: 0.2, width: 0.09, height: 0.04 },
        weight: 0.22,
        color: "#b45309",
        geometry: { shape: "box", length: 0.2, height: 0.04, width: 0.09 },
        massKg: 0.22,
        electrical: { nominalVoltageV: 11.1, capacityMah: 2200 },
      };

      const controllerDef: ControllerDefinition = {
        id: "arduino-uno",
        name: "Arduino Uno",
        controllerType: "Microcontroller board",
        dimensions: { length: 0.069, width: 0.054, height: 0.015 },
        weight: 0.025,
        color: "#177e89",
        processor: "ATmega328P",
        clockMHz: 16,
        operatingVoltage: "5V",
        geometry: { shape: "box", length: 0.069, height: 0.015, width: 0.054 },
        massKg: 0.025,
        electrical: { nominalVoltageV: 5.0 },
      };

      const foundationDef: FoundationModel = {
        id: "compact-square",
        name: "Compact Square",
        description: "Small chassis",
        length: 1.6,
        width: 1.4,
        height: 0.28,
        icon: "▣",
        geometry: { shape: "box", length: 1.6, height: 0.28, width: 1.4 },
      };

      expect(motorDef.engineeringSpec).toBeDefined();
      expect(wheelDef.engineeringSpec).toBeUndefined();
      expect(batteryDef.engineeringSpec).toBeUndefined();
      expect(controllerDef.engineeringSpec).toBeUndefined();
      expect(foundationDef.engineeringSpec).toBeUndefined();
    });
  });
});
