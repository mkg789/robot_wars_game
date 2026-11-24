import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "./robotStore";
import { initialParts } from "../features/robot-builder/data/initialRobot";
import { toBoundingBoxExtents } from "../features/robot-builder/logic/geometryAdapters";
import { motorCatalogue } from "../features/robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../features/robot-builder/data/wheelCatalogue";
import { batteryCatalogue } from "../features/robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../features/robot-builder/data/controllerCatalogue";
import { foundationModels } from "../features/robot-builder/data/foundationModels";
import { resolveComponentEngineeringSpec } from "../features/robot-builder/logic/engineeringAdapters";

describe("Runtime Part Population (Phase 2.4C.4.2)", () => {
  beforeEach(() => {
    useRobotStore.setState({
      parts: [...initialParts],
      connections: [],
      hiddenPartIds: [],
      selectedId: null,
      transformMode: "select",
      foundation: null,
      foundationId: null,
      stage: "foundation",
      drivetrain: {
        type: "differential-2",
        left: [null],
        right: [null],
        mappingCustomized: false,
      },
      selectedMotorCatalogueId: null,
      selectedMountZoneId: null,
      selectedWheelCatalogueId: null,
      selectedWheelMotorId: null,
      selectedWheelDiameterCm: 22,
      selectedWheelWidthCm: 7,
      selectedBatteryCatalogueId: null,
      selectedControllerCatalogueId: null,
    });
  });

  describe("Initial robot parts", () => {
    it("populates canonical BoxGeometry and massKg on default initial parts", () => {
      const chassis = initialParts.find((p) => p.id === "chassis");
      expect(chassis?.geometry).toEqual({
        shape: "box",
        length: 2,
        height: 0.35,
        width: 1.4,
      });
      expect(chassis?.massKg).toBe(1.5);
      expect(chassis?.mass).toBe(1.5);
      expect(chassis?.size).toEqual([2, 0.35, 1.4]);
    });
  });

  describe("Foundation and derived parts", () => {
    it("populates canonical BoxGeometry and massKg for preset foundations", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.selectFoundationModel("standard-rectangular");

      const state = useRobotStore.getState();
      const chassis = state.parts.find((p) => p.id === "foundation-chassis");
      expect(chassis?.geometry).toEqual({
        shape: "box",
        length: 2,
        height: 0.35,
        width: 1.5,
      });
      expect(chassis?.massKg).toBe(chassis?.mass);
      expect(chassis?.size).toEqual([2, 0.35, 1.5]);

      if (chassis?.geometry) {
        expect(toBoundingBoxExtents(chassis.geometry)).toEqual([2, 0.35, 1.5]);
      }
    });

    it("populates canonical geometry correctly when foundation dimensions are customized", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.selectFoundationModel("compact-square");
      store.setFoundationOptions({ includeFrontCover: true });
      store.updateFoundationDimensions({ length: 2.4, height: 0.4, width: 1.8 });

      const state = useRobotStore.getState();
      const chassis = state.parts.find((p) => p.id === "foundation-chassis");
      expect(chassis?.geometry).toEqual({
        shape: "box",
        length: 2.4,
        height: 0.4,
        width: 1.8,
      });
      expect(chassis?.size).toEqual([2.4, 0.4, 1.8]);
      expect(chassis?.massKg).toBe(chassis?.mass);

      // Top plate derived geometry
      const topPlate = state.parts.find((p) => p.id === "foundation-top-plate");
      expect(topPlate?.geometry).toEqual({
        shape: "box",
        length: 2.4 * 0.82,
        height: 0.12,
        width: 1.8 * 0.78,
      });
      expect(topPlate?.massKg).toBe(topPlate?.mass);
      expect(topPlate?.size).toEqual([2.4 * 0.82, 0.12, 1.8 * 0.78]);

      // Front cover derived geometry
      const frontCover = state.parts.find((p) => p.id === "foundation-front-cover");
      expect(frontCover?.geometry).toEqual({
        shape: "box",
        length: 0.12,
        height: 0.4 * 0.55,
        width: 1.8 * 0.9,
      });
      expect(frontCover?.massKg).toBe(frontCover?.mass);
      expect(frontCover?.size).toEqual([0.12, 0.4 * 0.55, 1.8 * 0.9]);
    });
  });

  describe("Motors", () => {
    it("populates canonical geometry, massKg, and mechanical specs when placing a motor", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const state = useRobotStore.getState();
      const motor = state.parts.find(
        (p) => p.type === "Motor" && p.mountingZoneId === "front-left"
      );

      expect(motor).toBeDefined();
      expect(motor?.geometry).toEqual({
        shape: "box",
        length: 0.38,
        height: 0.34,
        width: 0.42,
      });
      expect(motor?.massKg).toBe(0.48);
      expect(motor?.mass).toBe(0.48);
      expect(motor?.size).toEqual([0.38, 0.34, 0.42]);
      expect(motor?.mechanical).toEqual({
        stallTorqueNm: 0.8,
        noLoadRpm: 150,
      });
    });

    it("updates canonical geometry, massKg, and mechanical specs when replacing a motor", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("small-dc");
      store.placeMotor();

      // Replace with high-torque motor
      store.selectMotorCatalogueItem("high-torque-dc");
      store.replaceMotor("front-left");

      const state = useRobotStore.getState();
      const motor = state.parts.find(
        (p) => p.type === "Motor" && p.mountingZoneId === "front-left"
      );

      expect(motor?.geometry).toEqual({
        shape: "box",
        length: 0.46,
        height: 0.42,
        width: 0.5,
      });
      expect(motor?.massKg).toBe(0.82);
      expect(motor?.mechanical?.stallTorqueNm).toBe(1.6);
      expect(motor?.mechanical?.noLoadRpm).toBe(90);
    });
  });

  describe("Wheels", () => {
    it("populates canonical CylinderGeometry with explicit axis 'x' when assigning a wheel", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const motor = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Motor");
      expect(motor).toBeDefined();

      store.selectWheelCatalogueItem("standard-rubber");
      store.assignWheel(motor!.id);

      const state = useRobotStore.getState();
      const wheel = state.parts.find((p) => p.type === "Wheel");

      expect(wheel).toBeDefined();
      expect(wheel?.geometry).toEqual({
        shape: "cylinder",
        diameter: 0.22,
        axialWidth: 0.07,
        axis: "x",
      });
      expect(wheel?.massKg).toBe(0.16);
      expect(wheel?.mass).toBe(0.16);
      expect(wheel?.wheelDiameter).toBe(0.22);
      expect(wheel?.wheelWidth).toBe(0.07);
      expect(wheel?.size).toEqual([0.22, 0.07, 0.22]);
    });

    it("updates canonical CylinderGeometry when wheel dimensions are customized", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const motor = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Motor");

      store.selectWheelCatalogueItem("heavy-duty");
      store.assignWheel(motor!.id);
      store.selectWheelMotor(motor!.id);

      // Customize diameter to 34cm and width to 14cm
      store.updateSelectedWheelDimensions({ diameterCm: 34, widthCm: 14 });

      const state = useRobotStore.getState();
      const wheel = state.parts.find((p) => p.type === "Wheel");

      expect(wheel?.geometry).toEqual({
        shape: "cylinder",
        diameter: 0.34,
        axialWidth: 0.14,
        axis: "x",
      });
      expect(wheel?.wheelDiameter).toBe(0.34);
      expect(wheel?.wheelWidth).toBe(0.14);
      expect(wheel?.size).toEqual([0.34, 0.14, 0.34]);
      expect(wheel?.massKg).toBe(0.32);
    });
  });

  describe("Batteries", () => {
    it("populates canonical BoxGeometry, massKg, and electrical specs when installing a battery", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.installBattery("standard-lipo");

      const state = useRobotStore.getState();
      const battery = state.parts.find((p) => p.type === "Battery");

      expect(battery).toBeDefined();
      expect(battery?.geometry).toEqual({
        shape: "box",
        length: 0.2,
        height: 0.04,
        width: 0.09,
      });
      expect(battery?.massKg).toBe(0.22);
      expect(battery?.mass).toBe(0.22);
      expect(battery?.size).toEqual([0.2, 0.04, 0.09]);
      expect(battery?.electrical).toEqual({
        nominalVoltageV: 11.1,
        capacityMah: 2200,
      });
    });
  });

  describe("Controllers", () => {
    it("populates canonical BoxGeometry, massKg, and electrical specs when installing a controller", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.installController("esp32-devkit");

      const state = useRobotStore.getState();
      const controller = state.parts.find((p) => p.type === "Controller");

      expect(controller).toBeDefined();
      expect(controller?.geometry).toEqual({
        shape: "box",
        length: 0.055,
        height: 0.01,
        width: 0.028,
      });
      expect(controller?.massKg).toBe(0.009);
      expect(controller?.mass).toBe(0.009);
      expect(controller?.size).toEqual([0.055, 0.01, 0.028]);
      expect(controller?.electrical).toEqual({
        nominalVoltageV: 3.3,
      });
    });
  });

  describe("Runtime Engineering Data Integrity (Phase 3.4.1)", () => {
    it("populates engineering specifications on runtime parts for all catalogue-based components", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.selectFoundationModel("standard-rectangular");
      store.confirmFoundation();

      // Battery
      store.installBattery("standard-lipo");

      // Controller
      store.installController("esp32-devkit");

      // Motor
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const motor = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Motor");
      expect(motor).toBeDefined();

      // Wheel
      store.selectWheelCatalogueItem("standard-rubber");
      store.assignWheel(motor!.id);

      const state = useRobotStore.getState();
      const chassis = state.parts.find((p) => p.id === "foundation-chassis");
      const battery = state.parts.find((p) => p.type === "Battery");
      const controller = state.parts.find((p) => p.type === "Controller");
      const placedMotor = state.parts.find((p) => p.type === "Motor");
      const wheel = state.parts.find((p) => p.type === "Wheel");

      // Foundation chassis
      expect(chassis?.foundationModelId).toBe("standard-rectangular");
      expect(chassis?.engineeringSpec).toBeDefined();
      expect(chassis?.engineeringSpec?.category).toBe("structural");
      if (chassis?.engineeringSpec?.category === "structural") {
        expect(chassis.engineeringSpec.role).toBe("chassis-frame");
        if (chassis.engineeringSpec.generalProvenance?.method === "datasheet") {
          expect(chassis.engineeringSpec.generalProvenance.source).toBe("catalogue:foundation:standard-rectangular");
        }
      }

      // Battery
      expect(battery?.engineeringSpec).toBeDefined();
      expect(battery?.engineeringSpec?.category).toBe("battery");
      if (battery?.engineeringSpec?.category === "battery") {
        expect(battery.engineeringSpec.chemistry).toBe("lipo");
        expect(battery.engineeringSpec.electrical?.nominalVoltageV).toBe(11.1);
        expect(battery.engineeringSpec.electrical?.capacityMah).toBe(2200);
        if (battery.engineeringSpec.generalProvenance?.method === "datasheet") {
          expect(battery.engineeringSpec.generalProvenance.source).toBe("catalogue:battery:standard-lipo");
        }
      }

      // Controller
      expect(controller?.engineeringSpec).toBeDefined();
      expect(controller?.engineeringSpec?.category).toBe("controller");
      if (controller?.engineeringSpec?.category === "controller") {
        expect(controller.engineeringSpec.controllerType).toBe("microcontroller-board");
        expect(controller.engineeringSpec.processorArchitecture).toBe("Xtensa dual-core 32-bit LX6");
        if (controller.engineeringSpec.generalProvenance?.method === "datasheet") {
          expect(controller.engineeringSpec.generalProvenance.source).toContain("espressif.com");
        }
      }

      // Motor
      expect(placedMotor?.engineeringSpec).toBeDefined();
      expect(placedMotor?.engineeringSpec?.category).toBe("motor");
      if (placedMotor?.engineeringSpec?.category === "motor") {
        expect(placedMotor.engineeringSpec.technology).toBe("brushed-dc");
        expect(placedMotor.engineeringSpec.mechanical?.stallTorqueNm).toBe(0.8);
        expect(placedMotor.engineeringSpec.mechanical?.noLoadSpeedRpm).toBe(150);
        if (placedMotor.engineeringSpec.generalProvenance?.method === "datasheet") {
          expect(placedMotor.engineeringSpec.generalProvenance.source).toBe("catalogue:motor:standard-dc");
        }
      }

      // Wheel
      expect(wheel?.engineeringSpec).toBeDefined();
      expect(wheel?.engineeringSpec?.category).toBe("wheel");
      if (wheel?.engineeringSpec?.category === "wheel") {
        expect(wheel.engineeringSpec.treadType).toBe("rubber");
        if (wheel.engineeringSpec.generalProvenance?.method === "datasheet") {
          expect(wheel.engineeringSpec.generalProvenance.source).toBe("catalogue:wheel:standard-rubber");
        }
      }
    });

    it("ensures runtime engineering specifications do not share mutable references with catalogue definitions", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.selectFoundationModel("standard-rectangular");
      store.confirmFoundation();
      store.installBattery("standard-lipo");
      store.installController("esp32-devkit");
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const placedMotor = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Motor")!;
      store.selectWheelCatalogueItem("standard-rubber");
      store.assignWheel(placedMotor.id);

      const state = useRobotStore.getState();
      const motor = state.parts.find((p) => p.type === "Motor")!;
      const wheel = state.parts.find((p) => p.type === "Wheel")!;
      const battery = state.parts.find((p) => p.type === "Battery")!;
      const controller = state.parts.find((p) => p.type === "Controller")!;
      const chassis = state.parts.find((p) => p.id === "foundation-chassis")!;

      const motorCat = motorCatalogue.find((m) => m.id === "standard-dc")!;
      const wheelCat = wheelCatalogue.find((w) => w.id === "standard-rubber")!;
      const batteryCat = batteryCatalogue.find((b) => b.id === "standard-lipo")!;
      const controllerCat = controllerCatalogue.find((c) => c.id === "esp32-devkit")!;
      const chassisCat = foundationModels.find((f) => f.id === "standard-rectangular")!;

      // Compare references: must NOT be referentially equal
      expect(motor.engineeringSpec).not.toBe(motorCat.engineeringSpec);
      expect(wheel.engineeringSpec).not.toBe(wheelCat.engineeringSpec);
      expect(battery.engineeringSpec).not.toBe(batteryCat.engineeringSpec);
      expect(controller.engineeringSpec).not.toBe(controllerCat.engineeringSpec);
      expect(chassis.engineeringSpec).not.toBe(chassisCat.engineeringSpec);

      // Mutate runtime specs to ensure deep isolation
      const originalMotorTorque = motorCat.engineeringSpec?.mechanical?.stallTorqueNm;
      if (motor.engineeringSpec?.category === "motor" && motor.engineeringSpec.mechanical) {
        (motor.engineeringSpec.mechanical as { stallTorqueNm: number }).stallTorqueNm = 999;
      }
      expect(motorCat.engineeringSpec?.mechanical?.stallTorqueNm).toBe(originalMotorTorque);

      const originalWheelTread = wheelCat.engineeringSpec?.treadType;
      if (wheel.engineeringSpec?.category === "wheel") {
        (wheel.engineeringSpec as { treadType?: string }).treadType = "hard-plastic";
      }
      expect(wheelCat.engineeringSpec?.treadType).toBe(originalWheelTread);

      const originalBatteryCapacity = batteryCat.engineeringSpec?.electrical?.capacityMah;
      if (battery.engineeringSpec?.category === "battery" && battery.engineeringSpec.electrical) {
        (battery.engineeringSpec.electrical as { capacityMah: number }).capacityMah = 99999;
      }
      expect(batteryCat.engineeringSpec?.electrical?.capacityMah).toBe(originalBatteryCapacity);

      const originalControllerPins = controllerCat.engineeringSpec?.interfaces?.digitalIoPins;
      if (controller.engineeringSpec?.category === "controller" && controller.engineeringSpec.interfaces) {
        (controller.engineeringSpec.interfaces as { digitalIoPins: number }).digitalIoPins = 999;
      }
      expect(controllerCat.engineeringSpec?.interfaces?.digitalIoPins).toBe(originalControllerPins);

      const originalChassisRole = chassisCat.engineeringSpec?.role;
      if (chassis.engineeringSpec?.category === "structural") {
        (chassis.engineeringSpec as { role: string }).role = "armor-plate";
      }
      expect(chassisCat.engineeringSpec?.role).toBe(originalChassisRole);
    });

    it("ensures runtime electrical, mechanical, and geometry objects do not mutate catalogue definitions", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.installBattery("compact-lipo");
      store.installController("arduino-uno");
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("small-dc");
      store.placeMotor();

      const state = useRobotStore.getState();
      const motor = state.parts.find((p) => p.type === "Motor")!;
      const battery = state.parts.find((p) => p.type === "Battery")!;
      const controller = state.parts.find((p) => p.type === "Controller")!;

      const motorCat = motorCatalogue.find((m) => m.id === "small-dc")!;
      const batteryCat = batteryCatalogue.find((b) => b.id === "compact-lipo")!;
      const controllerCat = controllerCatalogue.find((c) => c.id === "arduino-uno")!;

      // Geometry references
      expect(motor.geometry).not.toBe(motorCat.geometry);
      expect(battery.geometry).not.toBe(batteryCat.geometry);
      expect(controller.geometry).not.toBe(controllerCat.geometry);

      // Mechanical references
      expect(motor.mechanical).not.toBe(motorCat.mechanical);

      // Electrical references
      expect(battery.electrical).not.toBe(batteryCat.electrical);
      expect(controller.electrical).not.toBe(controllerCat.electrical);

      // Mutate runtime object fields
      const originalMotorGeoLength = motorCat.geometry.length;
      if (motor.geometry?.shape === "box") {
        (motor.geometry as { length: number }).length = 999;
      }
      expect(motorCat.geometry.length).toBe(originalMotorGeoLength);

      const originalBatteryVoltage = batteryCat.electrical?.nominalVoltageV;
      if (battery.electrical) {
        (battery.electrical as { nominalVoltageV: number }).nominalVoltageV = 999;
      }
      expect(batteryCat.electrical?.nominalVoltageV).toBe(originalBatteryVoltage);

      const originalMotorStallTorque = motorCat.mechanical?.stallTorqueNm;
      if (motor.mechanical) {
        (motor.mechanical as { stallTorqueNm: number }).stallTorqueNm = 999;
      }
      expect(motorCat.mechanical?.stallTorqueNm).toBe(originalMotorStallTorque);
    });

    it("assigns foundationModelId correctly across all foundation models", () => {
      const store = useRobotStore.getState();

      store.startNewBuild();
      store.selectFoundationModel("compact-square");
      let chassis = useRobotStore.getState().parts.find((p) => p.id === "foundation-chassis");
      expect(chassis?.foundationModelId).toBe("compact-square");

      store.selectFoundationModel("standard-rectangular");
      chassis = useRobotStore.getState().parts.find((p) => p.id === "foundation-chassis");
      expect(chassis?.foundationModelId).toBe("standard-rectangular");

      store.selectFoundationModel("long-frame");
      chassis = useRobotStore.getState().parts.find((p) => p.id === "foundation-chassis");
      expect(chassis?.foundationModelId).toBe("long-frame");
    });

    it("ensures foundation identity resolution does not depend on display-name matching", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.selectFoundationModel("compact-square");

      const chassis = useRobotStore.getState().parts.find((p) => p.id === "foundation-chassis")!;
      expect(chassis.foundationModelId).toBe("compact-square");

      // Simulate a part whose name has been customized or renamed
      const renamedPart = {
        ...chassis,
        name: "Custom Heavy Armor Combat Platform",
        engineeringSpec: undefined, // Test resolver fallback to catalogue via foundationModelId
      };

      const resolved = resolveComponentEngineeringSpec(renamedPart);
      expect(resolved).toBeDefined();
      expect(resolved?.category).toBe("structural");
      if (resolved?.category === "structural") {
        expect(resolved.role).toBe("chassis-frame");
        if (resolved.generalProvenance?.method === "datasheet") {
          expect(resolved.generalProvenance.source).toBe("catalogue:foundation:compact-square");
          expect(resolved.generalProvenance.verified).toBe(false);
        }
      }
    });

    it("updates engineeringSpec on motor replacement to match the new motor catalogue spec", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("small-dc");
      store.placeMotor();

      let motor = useRobotStore.getState().parts.find((p) => p.type === "Motor")!;
      expect(motor.motorCatalogueId).toBe("small-dc");
      expect(motor.engineeringSpec?.category).toBe("motor");
      if (motor.engineeringSpec?.category === "motor") {
        expect(motor.engineeringSpec.mechanical?.stallTorqueNm).toBe(0.35);
        expect(motor.engineeringSpec.mechanical?.noLoadSpeedRpm).toBe(180);
        if (motor.engineeringSpec.generalProvenance?.method === "datasheet") {
          expect(motor.engineeringSpec.generalProvenance.source).toBe("catalogue:motor:small-dc");
        }
      }

      // Replace with standard-dc
      store.selectMotorCatalogueItem("standard-dc");
      store.replaceMotor("front-left");

      motor = useRobotStore.getState().parts.find((p) => p.type === "Motor")!;
      expect(motor.motorCatalogueId).toBe("standard-dc");
      expect(motor.engineeringSpec?.category).toBe("motor");
      if (motor.engineeringSpec?.category === "motor") {
        expect(motor.engineeringSpec.mechanical?.stallTorqueNm).toBe(0.8);
        expect(motor.engineeringSpec.mechanical?.noLoadSpeedRpm).toBe(150);
        if (motor.engineeringSpec.generalProvenance?.method === "datasheet") {
          expect(motor.engineeringSpec.generalProvenance.source).toBe("catalogue:motor:standard-dc");
        }
      }
    });
  });

  describe("Replacement & Customization Integrity (Phase 3.4.2)", () => {
    it("clears stale electrical and foreign fields on motor replacement and prevents catalogue mutation", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("small-dc");
      store.placeMotor();

      // Simulate stale legacy and foreign fields on the existing motor part
      const initialMotor = useRobotStore
        .getState()
        .parts.find((p) => p.mountingZoneId === "front-left")!;
      useRobotStore.setState({
        parts: useRobotStore.getState().parts.map((p) =>
          p.id === initialMotor.id
            ? {
                ...p,
                electrical: { nominalVoltageV: 48, maxCurrentA: 50 },
                wheelDiameter: 0.22,
                wheelWidth: 0.07,
                wheelCatalogueId: "standard-rubber",
                batteryCatalogueId: "standard-lipo",
                controllerCatalogueId: "arduino-uno",
                foundationModelId: "compact-square",
              }
            : p
        ),
      });

      // Replace motor with high-torque-dc
      store.selectMotorCatalogueItem("high-torque-dc");
      store.replaceMotor("front-left");

      const replacedMotor = useRobotStore
        .getState()
        .parts.find((p) => p.mountingZoneId === "front-left")!;

      expect(replacedMotor.motorCatalogueId).toBe("high-torque-dc");
      // Verify stale fields are explicitly cleared
      expect(replacedMotor.electrical).toBeUndefined();
      expect(replacedMotor.wheelDiameter).toBeUndefined();
      expect(replacedMotor.wheelWidth).toBeUndefined();
      expect(replacedMotor.wheelCatalogueId).toBeUndefined();
      expect(replacedMotor.batteryCatalogueId).toBeUndefined();
      expect(replacedMotor.controllerCatalogueId).toBeUndefined();
      expect(replacedMotor.foundationModelId).toBeUndefined();

      // Verify engineering spec belongs to high-torque-dc
      expect(replacedMotor.engineeringSpec?.category).toBe("motor");
      if (replacedMotor.engineeringSpec?.category === "motor") {
        expect(replacedMotor.engineeringSpec.mechanical?.stallTorqueNm).toBe(1.6);
        expect(replacedMotor.engineeringSpec.mechanical?.noLoadSpeedRpm).toBe(90);
        // Ensure resolver does not pick up stale 48V
        const resolved = resolveComponentEngineeringSpec(replacedMotor);
        expect(resolved?.category).toBe("motor");
        if (resolved?.category === "motor") {
          expect(resolved.electrical?.nominalVoltageV).toBeUndefined();
        }
      }

      // Verify catalogue isolation: modifying runtime spec does not mutate catalogue
      const highTorqueCat = motorCatalogue.find((m) => m.id === "high-torque-dc")!;
      if (replacedMotor.engineeringSpec && "mechanical" in replacedMotor.engineeringSpec) {
        (replacedMotor.engineeringSpec.mechanical as { stallTorqueNm: number }).stallTorqueNm = 999;
      }
      expect(highTorqueCat.engineeringSpec?.mechanical?.stallTorqueNm).toBe(1.6);
    });

    it("replaces wheel engineering spec cleanly when reassigning wheel on a motor", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const motor = useRobotStore.getState().parts.find((p) => p.type === "Motor")!;

      // Assign standard-rubber wheel
      store.selectWheelCatalogueItem("standard-rubber");
      store.assignWheel(motor.id);

      let wheel = useRobotStore.getState().parts.find((p) => p.type === "Wheel")!;
      expect(wheel.wheelCatalogueId).toBe("standard-rubber");
      expect(wheel.engineeringSpec?.category).toBe("wheel");
      if (wheel.engineeringSpec?.category === "wheel") {
        expect(wheel.engineeringSpec.treadType).toBe("rubber");
      }

      // Reassign to heavy-duty wheel
      store.selectWheelCatalogueItem("heavy-duty");
      store.assignWheel(motor.id);

      wheel = useRobotStore.getState().parts.find((p) => p.type === "Wheel")!;
      expect(wheel.wheelCatalogueId).toBe("heavy-duty");
      expect(wheel.engineeringSpec?.category).toBe("wheel");
      if (wheel.engineeringSpec?.category === "wheel") {
        expect(wheel.engineeringSpec.treadType).toBe("polyurethane");
      }

      // Verify resolver reflects heavy-duty polyurethane
      const resolved = resolveComponentEngineeringSpec(wheel);
      expect(resolved?.category).toBe("wheel");
      if (resolved?.category === "wheel") {
        expect(resolved.treadType).toBe("polyurethane");
      }

      // Verify catalogue isolation
      const hdCat = wheelCatalogue.find((w) => w.id === "heavy-duty")!;
      expect(wheel.engineeringSpec).not.toBe(hdCat.engineeringSpec);
    });

    it("replaces battery and controller cleanly without retaining stale specs or references", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();

      // Install compact-lipo
      store.selectBatteryCatalogueItem("compact-lipo");
      store.installBattery("compact-lipo");

      let battery = useRobotStore.getState().parts.find((p) => p.type === "Battery")!;
      expect(battery.batteryCatalogueId).toBe("compact-lipo");
      expect(battery.engineeringSpec?.category).toBe("battery");
      if (battery.engineeringSpec?.category === "battery") {
        expect(battery.engineeringSpec.electrical?.nominalVoltageV).toBe(7.4);
        expect(battery.engineeringSpec.cellCountS).toBe(2);
      }

      // Replace with heavy-duty-lipo
      store.selectBatteryCatalogueItem("heavy-duty-lipo");
      store.installBattery("heavy-duty-lipo");

      battery = useRobotStore.getState().parts.find((p) => p.type === "Battery")!;
      expect(battery.batteryCatalogueId).toBe("heavy-duty-lipo");
      expect(battery.engineeringSpec?.category).toBe("battery");
      if (battery.engineeringSpec?.category === "battery") {
        expect(battery.engineeringSpec.electrical?.nominalVoltageV).toBe(14.8);
        expect(battery.engineeringSpec.cellCountS).toBe(4);
      }

      // Install arduino-uno
      store.selectControllerCatalogueItem("arduino-uno");
      store.installController("arduino-uno");

      let controller = useRobotStore.getState().parts.find((p) => p.type === "Controller")!;
      expect(controller.controllerCatalogueId).toBe("arduino-uno");
      expect(controller.engineeringSpec?.category).toBe("controller");
      if (controller.engineeringSpec?.category === "controller") {
        expect(controller.engineeringSpec.electrical?.logicLevelV).toBe(5);
        expect(controller.engineeringSpec.clockSpeedHz).toBe(16_000_000);
      }

      // Replace with esp32-devkit
      store.selectControllerCatalogueItem("esp32-devkit");
      store.installController("esp32-devkit");

      controller = useRobotStore.getState().parts.find((p) => p.type === "Controller")!;
      expect(controller.controllerCatalogueId).toBe("esp32-devkit");
      expect(controller.engineeringSpec?.category).toBe("controller");
      if (controller.engineeringSpec?.category === "controller") {
        expect(controller.engineeringSpec.electrical?.logicLevelV).toBe(3.3);
        expect(controller.engineeringSpec.clockSpeedHz).toBe(240_000_000);
      }

      // Remove battery and controller
      store.removeBattery();
      store.removeController();
      expect(useRobotStore.getState().parts.some((p) => p.type === "Battery")).toBe(false);
      expect(useRobotStore.getState().parts.some((p) => p.type === "Controller")).toBe(false);
    });

    it("preserves runtime customizations of mounted components when foundation is updated", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();

      store.selectBatteryCatalogueItem("standard-lipo");
      store.installBattery("standard-lipo");

      store.selectControllerCatalogueItem("arduino-uno");
      store.installController("arduino-uno");

      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const motor = useRobotStore.getState().parts.find((p) => p.type === "Motor")!;
      store.selectWheelCatalogueItem("standard-rubber");
      store.assignWheel(motor.id);

      // Apply runtime customizations to mounted battery and controller
      useRobotStore.setState({
        parts: useRobotStore.getState().parts.map((p) => {
          if (p.type === "Battery" && p.engineeringSpec?.category === "battery") {
            return {
              ...p,
              massKg: 0.95,
              engineeringSpec: {
                ...p.engineeringSpec,
                generalProvenance: {
                  method: "estimated" as const,
                  basis: "User bench-tested capacity rating",
                },
              },
            };
          }
          if (p.type === "Controller" && p.engineeringSpec?.category === "controller") {
            return {
              ...p,
              engineeringSpec: {
                ...p.engineeringSpec,
                generalProvenance: {
                  method: "estimated" as const,
                  basis: "User custom clock overclocking profile",
                },
              },
            };
          }
          return p;
        }),
      });

      // Update foundation dimensions
      store.updateFoundationDimensions({ length: 3.2, width: 2.2, height: 0.45 });

      const state = useRobotStore.getState();
      const updatedBattery = state.parts.find((p) => p.type === "Battery")!;
      const updatedController = state.parts.find((p) => p.type === "Controller")!;
      const updatedMotor = state.parts.find((p) => p.type === "Motor")!;
      const updatedWheel = state.parts.find((p) => p.type === "Wheel")!;

      // Verify custom engineering provenance and mass were preserved rather than re-cloned from baseline
      expect(updatedBattery.massKg).toBe(0.95);
      const batteryProv = updatedBattery.engineeringSpec?.generalProvenance;
      expect(batteryProv?.method).toBe("estimated");
      if (batteryProv?.method === "estimated") {
        expect(batteryProv.basis).toBe("User bench-tested capacity rating");
      }

      const controllerProv = updatedController.engineeringSpec?.generalProvenance;
      expect(controllerProv?.method).toBe("estimated");
      if (controllerProv?.method === "estimated") {
        expect(controllerProv.basis).toBe("User custom clock overclocking profile");
      }
      expect(updatedMotor.engineeringSpec?.category).toBe("motor");
      expect(updatedWheel.engineeringSpec?.category).toBe("wheel");
    });

    it("synchronizes plateThicknessM on Armor Plate when resized, without fabricating on chassis frame", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();

      // 1. Armor Plate with explicit plateThicknessM
      const armorPlateId = "custom-armor-plate";
      useRobotStore.setState({
        parts: [
          ...useRobotStore.getState().parts,
          {
            id: armorPlateId,
            name: "Front Armor 1",
            type: "Armor Plate",
            position: [0, 0.5, 1],
            rotation: [0, 0, 0],
            size: [1.5, 0.05, 1.0],
            color: "#64748b",
            mass: 0.5,
            massKg: 0.5,
            geometry: {
              shape: "box",
              length: 1.5,
              height: 0.05,
              width: 1.0,
            },
            engineeringSpec: {
              category: "structural",
              role: "armor-plate",
              plateThicknessM: 0.05,
              fieldProvenance: {},
              generalProvenance: {
                method: "estimated",
                basis: "Baseline sheet metal specification",
              },
            },
          },
        ],
      });

      // Resize armor plate via updatePartSize
      store.updatePartSize(armorPlateId, [1.5, 0.02, 1.0]);

      let plate = useRobotStore.getState().parts.find((p) => p.id === armorPlateId)!;
      expect(plate.size).toEqual([1.5, 0.02, 1.0]);
      expect(plate.geometry).toEqual({
        shape: "box",
        length: 1.5,
        height: 0.02,
        width: 1.0,
      });
      expect(plate.engineeringSpec?.category).toBe("structural");
      if (plate.engineeringSpec?.category === "structural") {
        expect(plate.engineeringSpec.plateThicknessM).toBe(0.02);
        const prov = plate.engineeringSpec.fieldProvenance?.plateThicknessM;
        expect(prov?.method).toBe("estimated");
        if (prov?.method === "estimated") {
          expect(prov.basis).toContain(
            "Synchronized from customized armor plate dimensions"
          );
        }
      }

      // Resize armor plate via updatePartGeometry
      store.updatePartGeometry(armorPlateId, {
        shape: "box",
        length: 2.0,
        height: 0.012,
        width: 0.8,
      });

      plate = useRobotStore.getState().parts.find((p) => p.id === armorPlateId)!;
      expect(plate.engineeringSpec?.category).toBe("structural");
      if (plate.engineeringSpec?.category === "structural") {
        expect(plate.engineeringSpec.plateThicknessM).toBe(0.012);
      }

      // 2. Chassis frame: ensure plateThicknessM remains strictly undefined
      const chassis = useRobotStore.getState().parts.find((p) => p.id === "foundation-chassis")!;
      expect(chassis.engineeringSpec?.category).toBe("structural");
      if (chassis.engineeringSpec?.category === "structural") {
        expect(chassis.engineeringSpec.plateThicknessM).toBeUndefined();
      }

      // Update foundation dimensions (chassis envelope)
      store.updateFoundationDimensions({ length: 2.8, width: 1.8, height: 0.4 });
      const updatedChassis = useRobotStore
        .getState()
        .parts.find((p) => p.id === "foundation-chassis")!;
      expect(updatedChassis.engineeringSpec?.category).toBe("structural");
      if (updatedChassis.engineeringSpec?.category === "structural") {
        // Must remain undefined (ground clearance / frame height, NOT plate thickness)
        expect(updatedChassis.engineeringSpec.plateThicknessM).toBeUndefined();
      }
    });

    it("preserves resolver integrity across replacement and customization cycles", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();

      // Mount motor, wheel, battery, controller
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("small-dc");
      store.placeMotor();

      const motor = useRobotStore.getState().parts.find((p) => p.type === "Motor")!;
      store.selectWheelCatalogueItem("standard-rubber");
      store.assignWheel(motor.id);

      store.selectBatteryCatalogueItem("standard-lipo");
      store.installBattery("standard-lipo");

      store.selectControllerCatalogueItem("arduino-uno");
      store.installController("arduino-uno");

      // Verify all resolvers immediately resolve canonical specs
      const state = useRobotStore.getState();
      const initialMotor = state.parts.find((p) => p.type === "Motor")!;
      const initialWheel = state.parts.find((p) => p.type === "Wheel")!;
      const initialBattery = state.parts.find((p) => p.type === "Battery")!;
      const initialController = state.parts.find((p) => p.type === "Controller")!;
      const chassis = state.parts.find((p) => p.id === "foundation-chassis")!;

      expect(resolveComponentEngineeringSpec(initialMotor)?.category).toBe("motor");
      expect(resolveComponentEngineeringSpec(initialWheel)?.category).toBe("wheel");
      expect(resolveComponentEngineeringSpec(initialBattery)?.category).toBe("battery");
      expect(resolveComponentEngineeringSpec(initialController)?.category).toBe("controller");
      expect(resolveComponentEngineeringSpec(chassis)?.category).toBe("structural");

      // Replace foundation model
      store.selectFoundationModel("long-frame");
      const updatedChassis = useRobotStore.getState().parts.find((p) => p.id === "foundation-chassis")!;
      expect(updatedChassis.foundationModelId).toBe("long-frame");
      const resolvedChassis = resolveComponentEngineeringSpec(updatedChassis);
      expect(resolvedChassis?.category).toBe("structural");
      if (resolvedChassis?.category === "structural" && resolvedChassis.generalProvenance?.method === "datasheet") {
        expect(resolvedChassis.generalProvenance.source).toBe("catalogue:foundation:long-frame");
      }
    });
  });
});
