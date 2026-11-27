import { describe, it, expect, beforeEach } from "vitest";
import {
  useRobotStore,
  syncGeometryFromSize,
  syncSizeFromGeometry,
} from "./robotStore";
import type { RobotPart } from "../features/robot-builder/types/robot.types";
import type { BoxGeometry, CylinderGeometry } from "../features/robot-builder/types/dimensions.types";

describe("Phase 2.4C.4.3: Store Canonicalization & Synchronization", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
  });

  describe("Synchronization Helpers", () => {
    it("syncGeometryFromSize derives box geometry for standard parts", () => {
      const boxPart: RobotPart = {
        id: "test-box",
        name: "Test Box",
        type: "Armor Plate",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [1, 0.5, 0.8],
        color: "#fff",
        mass: 10,
        geometry: { shape: "box", length: 1, height: 0.5, width: 0.8 },
      };

      const result = syncGeometryFromSize(boxPart, [2.5, 0.6, 1.8]);
      expect(result.size).toEqual([2.5, 0.6, 1.8]);
      expect(result.geometry).toEqual({
        shape: "box",
        length: 2.5,
        height: 0.6,
        width: 1.8,
      });
      expect(result.wheelDiameter).toBeUndefined();
      expect(result.wheelWidth).toBeUndefined();
    });

    it("syncGeometryFromSize derives cylinder geometry and wheel dimensions for Wheel parts", () => {
      const wheelPart: RobotPart = {
        id: "test-wheel",
        name: "Test Wheel",
        type: "Wheel",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.22, 0.07, 0.22],
        color: "#111",
        mass: 1.2,
        wheelDiameter: 0.22,
        wheelWidth: 0.07,
        geometry: {
          shape: "cylinder",
          diameter: 0.22,
          axialWidth: 0.07,
          axis: "x",
        },
      };

      const result = syncGeometryFromSize(wheelPart, [0.35, 0.12, 0.35]);
      expect(result.size).toEqual([0.35, 0.12, 0.35]);
      expect(result.wheelDiameter).toBe(0.35);
      expect(result.wheelWidth).toBe(0.12);
      expect(result.geometry).toEqual({
        shape: "cylinder",
        diameter: 0.35,
        axialWidth: 0.12,
        axis: "x",
      });
    });

    it("syncSizeFromGeometry converts box geometry into Cartesian extents", () => {
      const boxPart: RobotPart = {
        id: "test-chassis",
        name: "Chassis",
        type: "Armor Plate",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [1, 0.5, 1],
        color: "#fff",
        mass: 5,
      };

      const newGeometry: BoxGeometry = {
        shape: "box",
        length: 1.6,
        height: 0.3,
        width: 1.2,
      };

      const result = syncSizeFromGeometry(boxPart, newGeometry);
      expect(result.size).toEqual([1.6, 0.3, 1.2]);
      expect(result.geometry).toBe(newGeometry);
    });

    it("syncSizeFromGeometry converts cylinder geometry into [diameter, width, diameter] and syncs wheel fields", () => {
      const wheelPart: RobotPart = {
        id: "test-wheel",
        name: "Wheel",
        type: "Wheel",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.2, 0.05, 0.2],
        color: "#000",
        mass: 1,
      };

      const newGeometry: CylinderGeometry = {
        shape: "cylinder",
        diameter: 0.4,
        axialWidth: 0.15,
        axis: "x",
      };

      const result = syncSizeFromGeometry(wheelPart, newGeometry);
      expect(result.size).toEqual([0.4, 0.15, 0.4]);
      expect(result.wheelDiameter).toBe(0.4);
      expect(result.wheelWidth).toBe(0.15);
      expect(result.geometry).toBe(newGeometry);
    });

    it("F4: maps syncGeometryFromSize and syncSizeFromGeometry consistently by axis for structural X/Y/Z cylinders", () => {
      const baseProps = {
        id: "cyl-part",
        name: "Roller Shaft",
        type: "Structural Block" as const,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        size: [0.5, 0.1, 0.1] as [number, number, number],
        color: "#64748b",
        mass: 0.4,
      };

      // X-axis structural cylinder: [axialWidth, diameter, diameter]
      const cylX: RobotPart = {
        ...baseProps,
        geometry: { shape: "cylinder", diameter: 0.1, axialWidth: 0.5, axis: "x" },
      };
      const syncedX = syncGeometryFromSize(cylX, [0.8, 0.25, 0.25]);
      expect(syncedX.geometry).toEqual({
        shape: "cylinder",
        diameter: 0.25,
        axialWidth: 0.8,
        axis: "x",
      });
      expect(syncedX.size).toEqual([0.8, 0.25, 0.25]);
      expect(syncSizeFromGeometry(cylX, syncedX.geometry!).size).toEqual([0.8, 0.25, 0.25]);

      // Z-axis structural cylinder: [diameter, diameter, axialWidth]
      const cylZ: RobotPart = {
        ...baseProps,
        size: [0.1, 0.1, 0.5],
        geometry: { shape: "cylinder", diameter: 0.1, axialWidth: 0.5, axis: "z" },
      };
      const syncedZ = syncGeometryFromSize(cylZ, [0.3, 0.3, 0.9]);
      expect(syncedZ.geometry).toEqual({
        shape: "cylinder",
        diameter: 0.3,
        axialWidth: 0.9,
        axis: "z",
      });
      expect(syncedZ.size).toEqual([0.3, 0.3, 0.9]);
      expect(syncSizeFromGeometry(cylZ, syncedZ.geometry!).size).toEqual([0.3, 0.3, 0.9]);
    });
  });

  describe("Store Operations & Synchronization", () => {
    it("updatePartSize updates size and synchronizes canonical geometry for box components", () => {
      const store = useRobotStore.getState();
      const chassisId = "foundation-chassis";

      store.updatePartSize(chassisId, [2.2, 0.45, 1.6]);

      const updatedChassis = useRobotStore
        .getState()
        .parts.find((part) => part.id === chassisId);
      expect(updatedChassis).toBeDefined();
      expect(updatedChassis?.size).toEqual([2.2, 0.45, 1.6]);
      expect(updatedChassis?.geometry).toEqual({
        shape: "box",
        length: 2.2,
        height: 0.45,
        width: 1.6,
      });
    });

    it("updatePartSize updates size and synchronizes canonical geometry & legacy fields for Wheel components", () => {
      const store = useRobotStore.getState();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const motor = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Motor")!;
      store.selectWheelCatalogueItem("standard-rubber");
      store.assignWheel(motor.id);

      const wheel = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Wheel")!;
      expect(wheel).toBeDefined();

      store.updatePartSize(wheel.id, [0.32, 0.09, 0.32]);

      const updatedWheel = useRobotStore
        .getState()
        .parts.find((p) => p.id === wheel.id)!;
      expect(updatedWheel.size).toEqual([0.32, 0.09, 0.32]);
      expect(updatedWheel.wheelDiameter).toBe(0.32);
      expect(updatedWheel.wheelWidth).toBe(0.09);
      expect(updatedWheel.geometry).toEqual({
        shape: "cylinder",
        diameter: 0.32,
        axialWidth: 0.09,
        axis: "x",
      });
    });

    it("updatePartTransform synchronizes canonical geometry when size is supplied", () => {
      const store = useRobotStore.getState();
      const chassisId = "foundation-chassis";

      store.updatePartTransform(
        chassisId,
        [0.1, 0.2, 0.3],
        [0, 0.5, 0],
        [1.8, 0.35, 1.4]
      );

      const updated = useRobotStore
        .getState()
        .parts.find((p) => p.id === chassisId)!;
      expect(updated.position).toEqual([0.1, 0.2, 0.3]);
      expect(updated.rotation).toEqual([0, 0.5, 0]);
      expect(updated.size).toEqual([1.8, 0.35, 1.4]);
      expect(updated.geometry).toEqual({
        shape: "box",
        length: 1.8,
        height: 0.35,
        width: 1.4,
      });
    });

    it("updatePartTransform preserves existing geometry when size is omitted", () => {
      const store = useRobotStore.getState();
      const chassisId = "foundation-chassis";
      const originalGeometry = useRobotStore
        .getState()
        .parts.find((p) => p.id === chassisId)!.geometry;

      store.updatePartTransform(chassisId, [0.5, 0.5, 0.5], [0, 1, 0]);

      const updated = useRobotStore
        .getState()
        .parts.find((p) => p.id === chassisId)!;
      expect(updated.position).toEqual([0.5, 0.5, 0.5]);
      expect(updated.rotation).toEqual([0, 1, 0]);
      expect(updated.geometry).toEqual(originalGeometry);
    });

    it("updatePartGeometry sets canonical geometry and synchronizes legacy size", () => {
      const store = useRobotStore.getState();
      const chassisId = "foundation-chassis";

      const newGeometry: BoxGeometry = {
        shape: "box",
        length: 2.8,
        height: 0.6,
        width: 1.9,
      };

      store.updatePartGeometry(chassisId, newGeometry);

      const updated = useRobotStore
        .getState()
        .parts.find((p) => p.id === chassisId)!;
      expect(updated.geometry).toEqual(newGeometry);
      expect(updated.size).toEqual([2.8, 0.6, 1.9]);
    });

    it("updatePartGeometry on Wheel updates diameter, width, and size extents", () => {
      const store = useRobotStore.getState();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const motor = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Motor")!;
      store.selectWheelCatalogueItem("standard-rubber");
      store.assignWheel(motor.id);

      const wheel = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Wheel")!;

      const newGeometry: CylinderGeometry = {
        shape: "cylinder",
        diameter: 0.38,
        axialWidth: 0.14,
        axis: "x",
      };

      store.updatePartGeometry(wheel.id, newGeometry);

      const updatedWheel = useRobotStore
        .getState()
        .parts.find((p) => p.id === wheel.id)!;
      expect(updatedWheel.geometry).toEqual(newGeometry);
      expect(updatedWheel.size).toEqual([0.38, 0.14, 0.38]);
      expect(updatedWheel.wheelDiameter).toBe(0.38);
      expect(updatedWheel.wheelWidth).toBe(0.14);
    });

    it("updatePartMass updates both legacy mass and canonical massKg in lockstep", () => {
      const store = useRobotStore.getState();
      const chassisId = "foundation-chassis";

      store.updatePartMass(chassisId, 18.75);

      const updated = useRobotStore
        .getState()
        .parts.find((p) => p.id === chassisId)!;
      expect(updated.mass).toBe(18.75);
      expect(updated.massKg).toBe(18.75);
    });

    it("replaceMotor uses canonical geometry from attached wheel to re-derive connection transform", () => {
      const store = useRobotStore.getState();
      store.confirmFoundation();
      store.selectMountZone("front-left");
      store.selectMotorCatalogueItem("standard-dc");
      store.placeMotor();

      const motor = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Motor")!;
      store.selectWheelCatalogueItem("standard-rubber");
      store.assignWheel(motor.id);

      const wheel = useRobotStore
        .getState()
        .parts.find((p) => p.type === "Wheel")!;

      // Update wheel to customized canonical geometry
      store.updatePartGeometry(wheel.id, {
        shape: "cylinder",
        diameter: 0.26,
        axialWidth: 0.11,
        axis: "x",
      });

      // Replace motor with high-torque-dc
      store.selectMotorCatalogueItem("high-torque-dc");
      store.replaceMotor("front-left");

      const motorWheelConn = useRobotStore
        .getState()
        .connections.find((c) => c.type === "Motor-Wheel")!;
      expect(motorWheelConn).toBeDefined();
      expect(motorWheelConn.relativePosition).toBeDefined();
      expect(Array.isArray(motorWheelConn.relativePosition)).toBe(true);

      const postReplaceWheel = useRobotStore
        .getState()
        .parts.find((p) => p.id === wheel.id)!;
      expect(postReplaceWheel.wheelDiameter).toBe(0.26);
      expect(postReplaceWheel.wheelWidth).toBe(0.11);
      expect(postReplaceWheel.geometry).toEqual({
        shape: "cylinder",
        diameter: 0.26,
        axialWidth: 0.11,
        axis: "x",
      });
    });
  });
});
