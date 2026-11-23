import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "./robotStore";
import { initialParts } from "../features/robot-builder/data/initialRobot";
import { toBoundingBoxExtents } from "../features/robot-builder/logic/geometryAdapters";

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
});
