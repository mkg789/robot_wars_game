import { describe, expect, it } from "vitest";
import type { RobotPart } from "./robot.types";
import { toBoundingBoxExtents } from "../logic/geometryAdapters";

describe("RobotPart Runtime Type Extension", () => {
  it("allows legacy-only RobotPart instances without canonical fields", () => {
    const legacyPart: RobotPart = {
      id: "chassis-1",
      name: "Main Chassis",
      type: "Structural Block",
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      size: [2.0, 0.35, 1.5],
      color: "#313b49",
      mass: 12.5,
    };

    expect(legacyPart.id).toBe("chassis-1");
    expect(legacyPart.size).toEqual([2.0, 0.35, 1.5]);
    expect(legacyPart.mass).toBe(12.5);
    expect(legacyPart.geometry).toBeUndefined();
    expect(legacyPart.massKg).toBeUndefined();
    expect(legacyPart.electrical).toBeUndefined();
    expect(legacyPart.mechanical).toBeUndefined();
  });

  it("can carry canonical BoxGeometry on a robot part", () => {
    const boxPart: RobotPart = {
      id: "battery-1",
      name: "LiPo Pack",
      type: "Battery",
      position: [0, 0.6, 0],
      rotation: [0, 0, 0],
      size: [0.2, 0.04, 0.09],
      color: "#d97706",
      mass: 0.22,
      geometry: {
        shape: "box",
        length: 0.2,
        height: 0.04,
        width: 0.09,
      },
      massKg: 0.22,
    };

    expect(boxPart.geometry?.shape).toBe("box");
    if (boxPart.geometry?.shape === "box") {
      expect(boxPart.geometry.length).toBe(0.2);
      expect(boxPart.geometry.height).toBe(0.04);
      expect(boxPart.geometry.width).toBe(0.09);
      expect(toBoundingBoxExtents(boxPart.geometry)).toEqual([0.2, 0.04, 0.09]);
    }
  });

  it("can carry canonical CylinderGeometry with axis X (drive wheel)", () => {
    const driveWheelPart: RobotPart = {
      id: "wheel-left-1",
      name: "Standard Drive Wheel",
      type: "Wheel",
      position: [0.5, 0.2, 0.7],
      rotation: [0, 0, 0],
      size: [0.22, 0.07, 0.22],
      wheelDiameter: 0.22,
      wheelWidth: 0.07,
      color: "#20242b",
      mass: 0.16,
      geometry: {
        shape: "cylinder",
        diameter: 0.22,
        axialWidth: 0.07,
        axis: "x",
      },
      massKg: 0.16,
    };

    expect(driveWheelPart.geometry?.shape).toBe("cylinder");
    if (driveWheelPart.geometry?.shape === "cylinder") {
      expect(driveWheelPart.geometry.axis).toBe("x");
      expect(driveWheelPart.geometry.diameter).toBe(0.22);
      expect(driveWheelPart.geometry.axialWidth).toBe(0.07);
      expect(toBoundingBoxExtents(driveWheelPart.geometry)).toEqual([0.07, 0.22, 0.22]);
    }
  });

  it("can carry canonical CylinderGeometry with axis Y (vertical weapon disc)", () => {
    const weaponDiscPart: RobotPart = {
      id: "weapon-disc-1",
      name: "Horizontal Spinning Disc",
      type: "Structural Block",
      position: [0.8, 0.4, 0],
      rotation: [0, 0, 0],
      size: [0.35, 0.02, 0.35],
      color: "#ef4444",
      mass: 1.8,
      geometry: {
        shape: "cylinder",
        diameter: 0.35,
        axialWidth: 0.02,
        axis: "y",
      },
      massKg: 1.8,
    };

    expect(weaponDiscPart.geometry?.shape).toBe("cylinder");
    if (weaponDiscPart.geometry?.shape === "cylinder") {
      expect(weaponDiscPart.geometry.axis).toBe("y");
      expect(toBoundingBoxExtents(weaponDiscPart.geometry)).toEqual([0.35, 0.02, 0.35]);
    }
  });

  it("can carry canonical CylinderGeometry with axis Z (transverse roller)", () => {
    const rollerPart: RobotPart = {
      id: "roller-1",
      name: "Front Roller",
      type: "Structural Block",
      position: [1.1, 0.1, 0],
      rotation: [0, 0, 0],
      size: [0.1, 0.1, 0.6],
      color: "#64748b",
      mass: 0.9,
      geometry: {
        shape: "cylinder",
        diameter: 0.1,
        axialWidth: 0.6,
        axis: "z",
      },
      massKg: 0.9,
    };

    expect(rollerPart.geometry?.shape).toBe("cylinder");
    if (rollerPart.geometry?.shape === "cylinder") {
      expect(rollerPart.geometry.axis).toBe("z");
      expect(toBoundingBoxExtents(rollerPart.geometry)).toEqual([0.1, 0.1, 0.6]);
    }
  });

  it("represents canonical massKg in kilograms alongside legacy mass", () => {
    const part: RobotPart = {
      id: "armor-1",
      name: "Top Plate",
      type: "Armor Plate",
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      size: [1.2, 0.05, 0.9],
      color: "#94a3b8",
      mass: 3.4,
      massKg: 3.4,
    };

    expect(part.mass).toBe(3.4);
    expect(part.massKg).toBe(3.4);
  });

  it("can carry electrical specifications on a controller or battery part", () => {
    const controllerPart: RobotPart = {
      id: "controller-1",
      name: "Arduino Uno",
      type: "Controller",
      position: [0, 0.6, 0.2],
      rotation: [0, 0, 0],
      size: [0.069, 0.015, 0.054],
      color: "#177e89",
      mass: 0.025,
      massKg: 0.025,
      electrical: {
        nominalVoltageV: 5.0,
      },
    };

    expect(controllerPart.electrical?.nominalVoltageV).toBe(5.0);
    expect(controllerPart.electrical?.capacityMah).toBeUndefined();
  });

  it("can carry mechanical specifications on a drive motor part", () => {
    const motorPart: RobotPart = {
      id: "motor-1",
      name: "Standard DC Motor",
      type: "Motor",
      position: [0.4, 0.3, 0.4],
      rotation: [0, -Math.PI / 2, 0],
      size: [0.38, 0.34, 0.42],
      color: "#f97316",
      mass: 0.48,
      massKg: 0.48,
      mechanical: {
        stallTorqueNm: 0.8,
        noLoadRpm: 150,
      },
    };

    expect(motorPart.mechanical?.stallTorqueNm).toBe(0.8);
    expect(motorPart.mechanical?.noLoadRpm).toBe(150);
  });
});
