import { describe, expect, it } from "vitest";
import type {
  BoxGeometry,
  CartesianBoundingExtents,
  CartesianBoundingTuple,
  ComponentGeometry,
  ComponentMass,
  CylinderAxis,
  CylinderGeometry,
  ElectricalSpecs,
  MechanicalSpecs,
} from "./dimensions.types";

describe("Canonical Dimensional Types", () => {
  it("represents rectangular box geometry with explicit length, height, and width", () => {
    const box: BoxGeometry = {
      shape: "box",
      length: 1.6, // X axis (Front-Rear)
      height: 0.28, // Y axis (Up-Down)
      width: 1.4, // Z axis (Lateral Left-Right)
    };

    expect(box.shape).toBe("box");
    expect(box.length).toBe(1.6);
    expect(box.height).toBe(0.28);
    expect(box.width).toBe(1.4);
  });

  it("represents cylindrical geometry with diameter, axial width, and explicit axis", () => {
    // Wheel mounted with rotational axis along longitudinal X
    const driveWheel: CylinderGeometry = {
      shape: "cylinder",
      diameter: 0.22,
      axialWidth: 0.07,
      axis: "x",
    };

    expect(driveWheel.shape).toBe("cylinder");
    expect(driveWheel.diameter).toBe(0.22);
    expect(driveWheel.axialWidth).toBe(0.07);
    expect(driveWheel.axis).toBe("x");
  });

  it("supports diverse cylinder axes without ambiguity", () => {
    const axes: CylinderAxis[] = ["x", "y", "z"];

    const wheelCylinder: CylinderGeometry = {
      shape: "cylinder",
      diameter: 0.28,
      axialWidth: 0.1,
      axis: "x", // Lateral side wheel oriented along X
    };

    const weaponDisc: CylinderGeometry = {
      shape: "cylinder",
      diameter: 0.35,
      axialWidth: 0.015,
      axis: "y", // Horizontal spinning weapon disc rotating about Y
    };

    const transverseRoller: CylinderGeometry = {
      shape: "cylinder",
      diameter: 0.08,
      axialWidth: 0.6,
      axis: "z", // Transverse front roller rotating about Z
    };

    expect(axes).toContain(wheelCylinder.axis);
    expect(axes).toContain(weaponDisc.axis);
    expect(axes).toContain(transverseRoller.axis);
    expect(weaponDisc.axis).toBe("y");
    expect(transverseRoller.axis).toBe("z");
  });

  it("correctly narrows the ComponentGeometry discriminated union", () => {
    const geometries: ComponentGeometry[] = [
      {
        shape: "box",
        length: 0.2,
        height: 0.04,
        width: 0.09,
      },
      {
        shape: "cylinder",
        diameter: 0.24,
        axialWidth: 0.09,
        axis: "x",
      },
    ];

    const descriptions = geometries.map((geom) => {
      if (geom.shape === "box") {
        return `Box: ${geom.length}m × ${geom.height}m × ${geom.width}m`;
      }
      return `Cylinder: D=${geom.diameter}m, W=${geom.axialWidth}m along ${geom.axis}`;
    });

    expect(descriptions[0]).toBe("Box: 0.2m × 0.04m × 0.09m");
    expect(descriptions[1]).toBe("Cylinder: D=0.24m, W=0.09m along x");
  });

  it("represents Cartesian bounding tuples and extents in canonical meters", () => {
    const tuple: CartesianBoundingTuple = [2.0, 0.35, 1.5];
    const extents: CartesianBoundingExtents = {
      x: 2.0,
      y: 0.35,
      z: 1.5,
    };

    expect(tuple[0]).toBe(extents.x);
    expect(tuple[1]).toBe(extents.y);
    expect(tuple[2]).toBe(extents.z);
  });

  it("represents component physical mass in kilograms", () => {
    const chassisMass: ComponentMass = {
      massKg: 12.5,
    };

    expect(chassisMass.massKg).toBe(12.5);
  });

  it("represents electrical and mechanical specifications in canonical units", () => {
    const motorMechanical: MechanicalSpecs = {
      stallTorqueNm: 0.8,
      noLoadRpm: 150,
    };

    const batteryElectrical: ElectricalSpecs = {
      nominalVoltageV: 11.1,
      capacityMah: 2200,
      continuousCurrentA: 45,
    };

    expect(motorMechanical.stallTorqueNm).toBe(0.8);
    expect(motorMechanical.noLoadRpm).toBe(150);
    expect(batteryElectrical.nominalVoltageV).toBe(11.1);
    expect(batteryElectrical.capacityMah).toBe(2200);
    expect(batteryElectrical.continuousCurrentA).toBe(45);
  });
});
