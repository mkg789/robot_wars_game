import { beforeEach, describe, expect, it } from "vitest";

import { initialParts } from "../features/robot-builder/data/initialRobot";
import { useRobotStore } from "./robotStore";
import {
  generateMotorMountZones,
  isMountZoneInsideFoundation,
} from "../features/robot-builder/logic/mountingZones";
import { wheelCatalogue } from "../features/robot-builder/data/wheelCatalogue";
import { batteryCatalogue } from "../features/robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../features/robot-builder/data/controllerCatalogue";
import { getWheelWorldMountTransform } from "../features/robot-builder/logic/wheelMounting";
import { getMotorShaftMountPosition } from "../features/robot-builder/logic/mounting";
import {
  clampWheelDimension,
  getWheelDimensionsInMeters,
  wheelDimensionBounds,
} from "../features/robot-builder/logic/wheelDimensions";

function resetStore() {
  useRobotStore.setState({
    parts: initialParts.map((part) => ({
      ...part,
      position: [...part.position] as [number, number, number],
      rotation: [...part.rotation] as [number, number, number],
      size: [...part.size] as [number, number, number],
    })),
    connections: [],
    hiddenPartIds: [],
    selectedId: "chassis",
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
    selectedBatteryCatalogueId: "standard-lipo",
    selectedControllerCatalogueId: "arduino-uno",
  });
}

function installMotorWheelAssemblies(
  zoneIds: string[] = [
    "front-left",
    "front-right",
    "rear-left",
    "rear-right",
  ]
) {
  const store = useRobotStore.getState();
  store.startNewBuild();
  store.confirmFoundation();

  for (const zoneId of zoneIds) {
    useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
    useRobotStore.getState().selectMountZone(zoneId);
    useRobotStore.getState().placeMotor();
  }

  const motors = useRobotStore
    .getState()
    .parts.filter((part) => part.type === "Motor");
  for (const motor of motors) {
    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().assignWheel(motor.id);
  }

  return useRobotStore.getState().parts.filter((part) => part.type === "Motor");
}

describe("robot assembly store", () => {
  beforeEach(resetStore);

  it("installs and replaces one battery as a visible foundation attachment", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.installBattery("compact-lipo");
    expect(
      useRobotStore.getState().parts.some((part) => part.type === "Battery")
    ).toBe(false);

    store.confirmFoundation();
    store.installBattery("compact-lipo");
    let state = useRobotStore.getState();
    const battery = state.parts.find((part) => part.type === "Battery");
    expect(battery).toBeDefined();
    if (!battery) return;

    const compactDefinition = batteryCatalogue.find(
      (item) => item.id === "compact-lipo"
    );
    expect(compactDefinition).toBeDefined();
    expect(battery.batteryCatalogueId).toBe("compact-lipo");
    expect(battery.size).toEqual([
      compactDefinition?.dimensions.length,
      compactDefinition?.dimensions.height,
      compactDefinition?.dimensions.width,
    ]);
    expect(battery.mass).toBe(compactDefinition?.weight);
    expect(battery.parentAttachmentId).toBeDefined();
    expect(
      state.connections.some(
        (connection) =>
          connection.type === "Mechanical" &&
          connection.parentId === "foundation-chassis" &&
          connection.childId === battery.id &&
          connection.id === battery.parentAttachmentId
      )
    ).toBe(true);

    store.togglePartVisibility(battery.id);
    state = useRobotStore.getState();
    expect(state.selectedId).toBe(battery.id);
    expect(state.hiddenPartIds).toContain(battery.id);
    expect(state.connections.some(
      (connection) =>
        connection.parentId === "foundation-chassis" &&
        connection.childId === battery.id
    )).toBe(true);
    store.selectBatteryCatalogueItem("heavy-duty-lipo");
    store.installBattery("heavy-duty-lipo");
    state = useRobotStore.getState();
    const replacement = state.parts.find((part) => part.type === "Battery");
    expect(replacement?.id).toBe(battery.id);
    expect(replacement?.batteryCatalogueId).toBe("heavy-duty-lipo");
    expect(state.parts.filter((part) => part.type === "Battery")).toHaveLength(1);
    expect(state.hiddenPartIds).toContain(battery.id);
    expect(state.selectedId).toBe(battery.id);
    expect(state.connections.filter(
      (connection) => connection.childId === battery.id
    )).toHaveLength(1);
  });

  it("cleans battery connections and visibility on removal and foundation deletion", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();
    store.installBattery("standard-lipo");
    const battery = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Battery");
    expect(battery).toBeDefined();
    if (!battery) return;
    store.togglePartVisibility(battery.id);
    store.removeBattery();

    let state = useRobotStore.getState();
    expect(state.parts.some((part) => part.id === battery.id)).toBe(false);
    expect(state.connections.some(
      (connection) =>
        connection.parentId === battery.id ||
        connection.childId === battery.id
    )).toBe(false);
    expect(state.hiddenPartIds).not.toContain(battery.id);
    expect(state.selectedId).toBe("foundation-chassis");

    store.installBattery("standard-lipo");
    const installedBattery = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Battery");
    expect(installedBattery).toBeDefined();
    if (!installedBattery) return;
    store.togglePartVisibility(installedBattery.id);
    store.setSelectedId("foundation-chassis");
    store.deleteSelected();

    state = useRobotStore.getState();
    expect(state.foundation).toBeNull();
    expect(state.foundationId).toBeNull();
    expect(state.parts).toHaveLength(0);
    expect(state.connections).toHaveLength(0);
    expect(state.hiddenPartIds).toHaveLength(0);
    expect(state.selectedId).toBeNull();
    expect(state.stage).toBe("foundation");
  });

  it("preserves and repositions an installed battery during foundation rebuilds", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();
    store.installBattery("standard-lipo");
    const originalBattery = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Battery");
    expect(originalBattery).toBeDefined();
    if (!originalBattery) return;

    store.updateFoundationDimensions({ height: 0.6 });
    store.setFoundationOptions({ includeTopPlate: false });
    const state = useRobotStore.getState();
    const battery = state.parts.find((part) => part.type === "Battery");
    const definition = batteryCatalogue.find(
      (item) => item.id === "standard-lipo"
    );
    expect(battery?.id).toBe(originalBattery.id);
    expect(battery?.position[1]).toBeCloseTo(
      0.6 + (definition?.dimensions.height ?? 0) * 0.5
    );
    expect(
      state.connections.some(
        (connection) =>
          connection.type === "Mechanical" &&
          connection.parentId === "foundation-chassis" &&
          connection.childId === originalBattery.id
      )
    ).toBe(true);
    expect(state.parts.filter((part) => part.type === "Battery")).toHaveLength(1);
  });

  it("installs and replaces one controller as a visible foundation attachment", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.installController("arduino-uno");
    expect(
      useRobotStore.getState().parts.some((part) => part.type === "Controller")
    ).toBe(false);

    store.confirmFoundation();
    store.installController("arduino-uno");
    let state = useRobotStore.getState();
    const controller = state.parts.find((part) => part.type === "Controller");
    const definition = controllerCatalogue.find(
      (item) => item.id === "arduino-uno"
    );
    expect(controller).toBeDefined();
    expect(definition).toBeDefined();
    if (!controller || !definition) return;

    expect(controller.controllerCatalogueId).toBe(definition.id);
    expect(controller.size).toEqual([
      definition.dimensions.length,
      definition.dimensions.height,
      definition.dimensions.width,
    ]);
    expect(controller.color).toBe(definition.color);
    expect(controller.mass).toBe(definition.weight);
    expect(
      state.connections.some(
        (connection) =>
          connection.type === "Mechanical" &&
          connection.parentId === "foundation-chassis" &&
          connection.childId === controller.id &&
          connection.id === controller.parentAttachmentId
      )
    ).toBe(true);

    store.togglePartVisibility(controller.id);
    store.selectControllerCatalogueItem("esp32-devkit");
    store.installController("esp32-devkit");
    state = useRobotStore.getState();
    const replacement = state.parts.find(
      (part) => part.type === "Controller"
    );
    expect(replacement?.id).toBe(controller.id);
    expect(replacement?.controllerCatalogueId).toBe("esp32-devkit");
    expect(state.parts.filter((part) => part.type === "Controller")).toHaveLength(1);
    expect(state.hiddenPartIds).toContain(controller.id);
    expect(state.selectedId).toBe(controller.id);
    expect(
      state.connections.filter((connection) => connection.childId === controller.id)
    ).toHaveLength(1);
  });

  it("cleans controller connections and visibility on removal and foundation deletion", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();
    store.installController("stm32-nucleo");
    const controller = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Controller");
    expect(controller).toBeDefined();
    if (!controller) return;

    store.togglePartVisibility(controller.id);
    store.removeController();
    let state = useRobotStore.getState();
    expect(state.parts.some((part) => part.id === controller.id)).toBe(false);
    expect(
      state.connections.some(
        (connection) =>
          connection.parentId === controller.id ||
          connection.childId === controller.id
      )
    ).toBe(false);
    expect(state.hiddenPartIds).not.toContain(controller.id);
    expect(state.selectedId).toBe("foundation-chassis");

    store.installController("stm32-nucleo");
    const installedController = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Controller");
    expect(installedController).toBeDefined();
    if (!installedController) return;
    store.togglePartVisibility(installedController.id);
    store.setSelectedId("foundation-chassis");
    store.deleteSelected();

    state = useRobotStore.getState();
    expect(state.foundation).toBeNull();
    expect(state.parts).toHaveLength(0);
    expect(state.connections).toHaveLength(0);
    expect(state.hiddenPartIds).toHaveLength(0);
    expect(state.selectedId).toBeNull();
  });

  it("preserves and repositions an installed controller during foundation rebuilds", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();
    store.installController("esp32-devkit");
    const original = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Controller");
    expect(original).toBeDefined();
    if (!original) return;

    store.togglePartVisibility(original.id);
    store.updateFoundationDimensions({ height: 0.6 });
    store.setFoundationOptions({ includeTopPlate: false });

    const state = useRobotStore.getState();
    const controller = state.parts.find((part) => part.type === "Controller");
    const definition = controllerCatalogue.find(
      (item) => item.id === "esp32-devkit"
    );
    expect(controller?.id).toBe(original.id);
    expect(controller?.position[1]).toBeCloseTo(
      0.6 + (definition?.dimensions.height ?? 0) * 0.5
    );
    expect(state.hiddenPartIds).toContain(original.id);
    expect(
      state.connections.some(
        (connection) =>
          connection.type === "Mechanical" &&
          connection.parentId === "foundation-chassis" &&
          connection.childId === original.id
      )
    ).toBe(true);
    expect(state.parts.filter((part) => part.type === "Controller")).toHaveLength(1);
  });

  it("defaults components to visible and toggles visibility independently of selection and connections", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    expect(useRobotStore.getState().hiddenPartIds).toEqual([]);
    store.confirmFoundation();
    store.selectMotorCatalogueItem("standard-dc");
    store.selectMountZone("front-left");
    store.placeMotor();

    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    expect(motor).toBeDefined();
    if (!motor) return;

    store.selectWheelCatalogueItem("standard-rubber");
    store.selectWheelMotor(motor.id);
    store.assignWheel(motor.id);
    const before = useRobotStore.getState();
    const wheel = before.parts.find((part) => part.type === "Wheel");
    expect(wheel).toBeDefined();
    if (!wheel) return;

    store.togglePartVisibility(motor.id);
    let state = useRobotStore.getState();
    expect(state.hiddenPartIds).toContain(motor.id);
    expect(state.selectedId).toBe(before.selectedId);
    expect(state.parts).toBe(before.parts);
    expect(state.connections).toBe(before.connections);

    store.togglePartVisibility(wheel.id);
    state = useRobotStore.getState();
    expect(state.hiddenPartIds).toEqual(
      expect.arrayContaining([motor.id, wheel.id])
    );
    store.togglePartVisibility(motor.id);
    store.togglePartVisibility(wheel.id);
    expect(useRobotStore.getState().hiddenPartIds).toEqual([]);
  });

  it("cleans visibility state when wheels and motors are replaced or removed", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();
    store.selectMotorCatalogueItem("standard-dc");
    store.selectMountZone("front-left");
    store.placeMotor();
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    expect(motor).toBeDefined();
    if (!motor) return;

    store.selectWheelCatalogueItem("heavy-duty");
    store.selectWheelMotor(motor.id);
    store.assignWheel(motor.id);
    const originalWheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    expect(originalWheel).toBeDefined();
    if (!originalWheel) return;

    store.togglePartVisibility(motor.id);
    store.togglePartVisibility(originalWheel.id);
    store.selectMotorCatalogueItem("small-dc");
    store.replaceMotor("front-left");

    expect(useRobotStore.getState().hiddenPartIds).toEqual([motor.id]);
    expect(
      useRobotStore.getState().parts.some((part) => part.id === originalWheel.id)
    ).toBe(false);

    store.selectWheelCatalogueItem("standard-rubber");
    store.assignWheel(motor.id);
    const replacementWheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    expect(replacementWheel).toBeDefined();
    if (!replacementWheel) return;

    store.togglePartVisibility(replacementWheel.id);
    store.removeWheel(motor.id);
    expect(useRobotStore.getState().hiddenPartIds).toEqual([motor.id]);

    store.assignWheel(motor.id);
    const finalWheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    expect(finalWheel).toBeDefined();
    if (!finalWheel) return;
    store.togglePartVisibility(finalWheel.id);
    store.removeMotor("front-left");
    expect(useRobotStore.getState().hiddenPartIds).toEqual([]);
  });

  it("adds multiple motors and wheels without overwriting components", () => {
    const store = useRobotStore.getState();
    store.addPart("Motor");
    store.addPart("Motor");
    store.addPart("Wheel");
    store.addPart("Wheel");

    const parts = useRobotStore.getState().parts;
    expect(parts.filter((part) => part.type === "Motor")).toHaveLength(2);
    expect(parts.filter((part) => part.type === "Wheel")).toHaveLength(2);
    expect(new Set(parts.map((part) => part.id)).size).toBe(parts.length);
  });

  it("updates only the requested component", () => {
    useRobotStore.getState().addPart("Motor");
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Motor");
    expect(motor).toBeDefined();
    if (!motor) return;

    useRobotStore
      .getState()
      .updatePartPosition(motor.id, [4, 2, -1]);

    const updated = useRobotStore
      .getState()
      .parts.find((part) => part.id === motor.id);
    expect(updated?.position).toEqual([4, 2, -1]);
  });

  it("mounts one wheel once and propagates motor movement", () => {
    const store = useRobotStore.getState();
    store.addPart("Motor");
    store.addPart("Wheel");

    let parts = useRobotStore.getState().parts;
    const motor = parts.find((part) => part.type === "Motor");
    const wheel = parts.find((part) => part.type === "Wheel");
    expect(motor).toBeDefined();
    expect(wheel).toBeDefined();
    if (!motor || !wheel) return;

    useRobotStore
      .getState()
      .updatePartPosition(motor.id, [3, 1, 2]);
    useRobotStore
      .getState()
      .mountWheelToMotor(motor.id, wheel.id);
    useRobotStore
      .getState()
      .mountWheelToMotor(motor.id, wheel.id);

    expect(
      useRobotStore
        .getState()
        .connections.filter(
          (connection) =>
            (connection.childId ?? connection.targetId) === wheel.id
        )
    ).toHaveLength(1);

    useRobotStore
      .getState()
      .updatePartPosition(motor.id, [5, 2, 3]);
    parts = useRobotStore.getState().parts;
    const mountedWheel = parts.find((part) => part.id === wheel.id);
    expect(mountedWheel?.position[0]).toBeGreaterThan(5);
  });

  it("unmounts a wheel and preserves its current world transform", () => {
    const store = useRobotStore.getState();
    store.addPart("Motor");
    store.addPart("Wheel");
    const parts = useRobotStore.getState().parts;
    const motor = parts.find((part) => part.type === "Motor");
    const wheel = parts.find((part) => part.type === "Wheel");
    if (!motor || !wheel) return;

    useRobotStore
      .getState()
      .mountWheelToMotor(motor.id, wheel.id);
    const before = useRobotStore
      .getState()
      .parts.find((part) => part.id === wheel.id);

    useRobotStore.getState().unmountPart(wheel.id);
    const after = useRobotStore
      .getState()
      .parts.find((part) => part.id === wheel.id);

    expect(after?.position).toEqual(before?.position);
    expect(after?.rotation).toEqual(before?.rotation);
    expect(after?.parentAttachmentId).toBeUndefined();
  });

  it("disconnects only the requested attachment and clears its child state", () => {
    const store = useRobotStore.getState();
    store.addPart("Motor");
    store.addPart("Motor");
    store.addPart("Wheel");
    store.addPart("Wheel");

    const parts = useRobotStore.getState().parts;
    const motors = parts.filter((part) => part.type === "Motor");
    const wheels = parts.filter((part) => part.type === "Wheel");
    expect(motors).toHaveLength(2);
    expect(wheels).toHaveLength(2);
    if (motors.length !== 2 || wheels.length !== 2) return;

    store.mountWheelToMotor(motors[0].id, wheels[0].id);
    store.mountWheelToMotor(motors[1].id, wheels[1].id);
    const firstConnection = useRobotStore
      .getState()
      .connections.find((connection) => connection.childId === wheels[0].id);
    const secondConnection = useRobotStore
      .getState()
      .connections.find((connection) => connection.childId === wheels[1].id);
    const attachedWheel = useRobotStore
      .getState()
      .parts.find((part) => part.id === wheels[0].id);
    expect(firstConnection).toBeDefined();
    expect(secondConnection).toBeDefined();
    expect(attachedWheel).toBeDefined();
    if (!firstConnection || !secondConnection || !attachedWheel) return;

    store.disconnectParts(firstConnection.id);

    const state = useRobotStore.getState();
    expect(state.parts.map((part) => part.id)).toEqual(
      expect.arrayContaining([...motors.map((part) => part.id), ...wheels.map((part) => part.id)])
    );
    expect(
      state.connections.some((connection) => connection.id === firstConnection.id)
    ).toBe(false);
    expect(
      state.connections.some((connection) => connection.id === secondConnection.id)
    ).toBe(true);
    expect(
      state.parts.find((part) => part.id === wheels[0].id)?.parentAttachmentId
    ).toBeUndefined();
    expect(
      state.parts.find((part) => part.id === wheels[1].id)?.parentAttachmentId
    ).toBe(secondConnection.id);
    expect(
      state.parts.find((part) => part.id === wheels[0].id)?.position
    ).toEqual(attachedWheel.position);
  });

  it("rejects self-mounting and removes an attached wheel with its motor", () => {
    const store = useRobotStore.getState();
    store.addPart("Motor");
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Motor");
    if (!motor) return;

    store.mountWheelToMotor(motor.id, motor.id);
    expect(useRobotStore.getState().connections).toHaveLength(0);

    store.addPart("Wheel");
    const wheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    if (!wheel) return;
    useRobotStore
      .getState()
      .mountWheelToMotor(motor.id, wheel.id);

    useRobotStore.setState({ selectedId: motor.id });
    useRobotStore.getState().deleteSelected();

    expect(
      useRobotStore.getState().parts.some((part) => part.id === wheel.id)
    ).toBe(false);
    expect(useRobotStore.getState().connections).toHaveLength(0);
  });

  it("places repeated components in different useful positions", () => {
    const store = useRobotStore.getState();
    store.addPart("Wheel");
    const first = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    store.addPart("Wheel");
    const wheels = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Wheel");
    const second = wheels.find((part) => part.id !== first?.id);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;

    expect(second.position).not.toEqual(first.position);
  });

  it("creates and configures a foundation as the primary structure", () => {
    useRobotStore.getState().startNewBuild();

    expect(useRobotStore.getState().foundation).not.toBeNull();
    expect(useRobotStore.getState().foundationId).toBe("foundation-chassis");
    expect(
      useRobotStore
        .getState()
        .parts.find((part) => part.id === "foundation-chassis")
    ).toBeDefined();

    useRobotStore
      .getState()
      .selectFoundationModel("long-frame");
    useRobotStore
      .getState()
      .updateFoundationDimensions({
        length: 2.8,
        width: 1.4,
        height: 0.4,
      });
    useRobotStore
      .getState()
      .setFoundationOptions({
        includeTopPlate: true,
        includeFrontCover: true,
      });

    const foundation = useRobotStore.getState().foundation;
    expect(foundation?.modelId).toBe("long-frame");
    expect(foundation?.length).toBeLessThanOrEqual(4);
    expect(
      useRobotStore
        .getState()
        .parts.find((part) => part.id === "foundation-front-cover")
    ).toBeDefined();

    useRobotStore.getState().confirmFoundation();
    expect(useRobotStore.getState().foundation?.confirmed).toBe(true);
  });

  it("deletes a foundation with its dependent motors, wheels and connections", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.setFoundationOptions({ includeFrontCover: true });
    store.confirmFoundation();

    for (const zoneId of ["front-left", "rear-left"]) {
      useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
      useRobotStore.getState().selectMountZone(zoneId);
      useRobotStore.getState().placeMotor();
    }

    const motors = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Motor");
    expect(motors).toHaveLength(2);
    for (const motor of motors) {
      useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
      useRobotStore.getState().assignWheel(motor.id);
    }
    const wheels = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Wheel");
    for (const part of [...motors, ...wheels]) {
      useRobotStore.getState().togglePartVisibility(part.id);
    }

    useRobotStore.getState().selectWheelMotor(motors[0].id);
    useRobotStore.getState().setSelectedId("foundation-chassis");
    useRobotStore.getState().deleteSelected();

    const state = useRobotStore.getState();
    expect(state.parts).toHaveLength(0);
    expect(state.connections).toHaveLength(0);
    expect(state.hiddenPartIds).toEqual([]);
    expect(state.foundation).toBeNull();
    expect(state.foundationId).toBeNull();
    expect(state.stage).toBe("foundation");
    expect(state.selectedId).toBeNull();
    expect(state.selectedWheelMotorId).toBeNull();
    expect(state.selectedMotorCatalogueId).toBeNull();
    expect(state.selectedMountZoneId).toBeNull();
    expect(state.selectedWheelCatalogueId).toBeNull();
  });

  it("preserves visibility and attachments when the foundation is resized", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();
    store.selectMotorCatalogueItem("standard-dc");
    store.selectMountZone("front-left");
    store.placeMotor();
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    expect(motor).toBeDefined();
    if (!motor) return;

    store.selectWheelCatalogueItem("standard-rubber");
    store.selectWheelMotor(motor.id);
    store.assignWheel(motor.id);
    const wheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    expect(wheel).toBeDefined();
    if (!wheel) return;

    store.togglePartVisibility(motor.id);
    store.togglePartVisibility(wheel.id);
    const previousConnections = useRobotStore.getState().connections;
    const previousConnectionIds = previousConnections.map(
      (connection) => connection.id
    );
    store.updateFoundationDimensions({ length: 3 });

    const state = useRobotStore.getState();
    expect(state.hiddenPartIds).toEqual(
      expect.arrayContaining([motor.id, wheel.id])
    );
    expect(state.connections.map((connection) => connection.id)).toEqual(
      previousConnectionIds
    );
    expect(
      state.connections.some(
        (connection) =>
          connection.type === "Motor-Wheel" &&
          connection.parentId === motor.id &&
          connection.childId === wheel.id
      )
    ).toBe(true);
    expect(state.parts.some((part) => part.id === motor.id)).toBe(true);
    expect(state.parts.some((part) => part.id === wheel.id)).toBe(true);
  });

  it("generates bounded mounting zones for configured foundations", () => {
    const foundation = {
      modelId: "long-frame" as const,
      length: 2.6,
      width: 1.25,
      height: 0.32,
      includeTopPlate: true,
      includeFrontCover: false,
      confirmed: true,
    };
    const zones = generateMotorMountZones(foundation);

    expect(zones).toHaveLength(4);
    expect(zones.every((zone) =>
      isMountZoneInsideFoundation(zone, foundation)
    )).toBe(true);
  });

  it("adds, replaces and removes motors at unique mounting zones", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().selectMotorCatalogueItem("small-dc");
    useRobotStore.getState().selectMountZone("front-left");
    useRobotStore.getState().placeMotor();

    let motors = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Motor");
    expect(motors).toHaveLength(1);
    expect(motors[0].mountingZoneId).toBe("front-left");

    useRobotStore.getState().selectMotorCatalogueItem("high-torque-dc");
    useRobotStore.getState().replaceMotor("front-left");
    motors = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Motor");
    expect(motors[0].motorCatalogueId).toBe("high-torque-dc");

    useRobotStore.getState().removeMotor("front-left");
    motors = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Motor");
    expect(motors).toHaveLength(0);
  });

  it("prevent duplicate zone assignments and persists motors after resizing", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
    useRobotStore.getState().selectMountZone("front-right");
    useRobotStore.getState().placeMotor();
    useRobotStore.getState().placeMotor();

    expect(
      useRobotStore
        .getState()
        .parts.filter((part) => part.mountingZoneId === "front-right")
    ).toHaveLength(1);

    useRobotStore
      .getState()
      .updateFoundationDimensions({
        length: 3,
        width: 2,
        height: 0.4,
      });

    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-right");
    expect(motor).toBeDefined();
    expect(motor?.motorCatalogueId).toBe("standard-dc");
  });

  it("offers the wheel catalogue and assigns wheels uniquely to installed motors", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();

    for (const zoneId of ["front-left", "rear-left"]) {
      useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
      useRobotStore.getState().selectMountZone(zoneId);
      useRobotStore.getState().placeMotor();
    }

    expect(wheelCatalogue).toHaveLength(4);
    let motors = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Motor");
    const firstMotor = motors.find((part) => part.mountingZoneId === "front-left");
    const secondMotor = motors.find((part) => part.mountingZoneId === "rear-left");
    expect(firstMotor).toBeDefined();
    expect(secondMotor).toBeDefined();
    if (!firstMotor || !secondMotor) return;

    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().selectWheelMotor(firstMotor.id);
    useRobotStore.getState().assignWheel(firstMotor.id);
    const firstWheelId = useRobotStore
      .getState()
      .connections.find((connection) => connection.parentId === firstMotor.id)
      ?.childId;

    useRobotStore.getState().assignWheel(firstMotor.id);
    expect(
      useRobotStore
        .getState()
        .connections.filter((connection) => connection.parentId === firstMotor.id)
    ).toHaveLength(1);

    useRobotStore.getState().selectWheelCatalogueItem("grip");
    useRobotStore.getState().assignWheel(firstMotor.id);
    useRobotStore.getState().selectWheelMotor(secondMotor.id);
    useRobotStore.getState().assignWheel(secondMotor.id);
    motors = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Motor");

    const wheels = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Wheel");
    expect(wheels).toHaveLength(2);
    expect(wheels.find((wheel) => wheel.id === firstWheelId)?.wheelCatalogueId)
      .toBe("grip");
    expect(
      new Set(
        useRobotStore
          .getState()
          .connections
          .filter((connection) => connection.type === "Motor-Wheel")
          .map((connection) => connection.parentId)
      ).size
    ).toBe(motors.length);
  });

  it("positions assigned wheels at motor shafts and preserves attachment transforms", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();
    store.selectMotorCatalogueItem("standard-dc");
    store.selectMountZone("front-left");
    store.placeMotor();
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    expect(motor).toBeDefined();
    if (!motor) return;

    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().selectWheelMotor(motor.id);
    useRobotStore.getState().assignWheel(motor.id);
    const wheelDefinition = wheelCatalogue.find(
      (wheel) => wheel.id === "standard-rubber"
    );
    expect(wheelDefinition).toBeDefined();
    if (!wheelDefinition) return;

    let currentMotor = useRobotStore
      .getState()
      .parts.find((part) => part.id === motor.id);
    let wheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    expect(currentMotor).toBeDefined();
    expect(wheel).toBeDefined();
    if (!currentMotor || !wheel) return;
    const wheelId = wheel.id;

    const expected = getWheelWorldMountTransform(currentMotor, wheelDefinition);
    expect(wheel.position).toEqual(expected.position);
    expect(wheel.rotation).toEqual(currentMotor.rotation);

    useRobotStore.getState().rotateMotor("front-left");
    currentMotor = useRobotStore
      .getState()
      .parts.find((part) => part.id === motor.id);
    wheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    expect(currentMotor).toBeDefined();
    expect(wheel).toBeDefined();
    if (!currentMotor || !wheel) return;
    expect(wheel.position[2]).toBeLessThan(currentMotor.position[2]);
    expect(wheel.rotation).toEqual(currentMotor.rotation);

    useRobotStore.getState().updateFoundationDimensions({ length: 3 });
    currentMotor = useRobotStore
      .getState()
      .parts.find((part) => part.id === motor.id);
    wheel = useRobotStore
      .getState()
      .parts.find((part) => part.id === wheelId);
    expect(currentMotor).toBeDefined();
    expect(wheel).toBeDefined();
    if (!currentMotor || !wheel) return;
    expect(wheel.position).toEqual(
      getWheelWorldMountTransform(currentMotor, wheelDefinition).position
    );
    expect(
      useRobotStore
        .getState()
        .connections.some(
          (connection) =>
            connection.parentId === motor.id &&
            connection.childId === wheelId
        )
    ).toBe(true);

    const foundation = useRobotStore
      .getState()
      .parts.find((part) => part.id === "foundation-chassis");
    expect(foundation).toBeDefined();
    if (!foundation) return;
    useRobotStore.getState().updatePartTransform(
      foundation.id,
      [foundation.position[0] + 1, foundation.position[1], foundation.position[2] + 2],
      [0, Math.PI / 2, 0]
    );
    currentMotor = useRobotStore
      .getState()
      .parts.find((part) => part.id === motor.id);
    wheel = useRobotStore
      .getState()
      .parts.find((part) => part.id === wheelId);
    expect(currentMotor).toBeDefined();
    expect(wheel).toBeDefined();
    if (!currentMotor || !wheel) return;
    expect(wheel.position).toEqual(
      getWheelWorldMountTransform(currentMotor, wheelDefinition).position
    );
    expect(wheel.rotation).toEqual(currentMotor.rotation);
  });

  it("keeps wheels aligned when the motor catalogue model is replaced", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().selectMotorCatalogueItem("small-dc");
    useRobotStore.getState().selectMountZone("front-left");
    useRobotStore.getState().placeMotor();
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    if (!motor) return;

    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().selectWheelMotor(motor.id);
    useRobotStore.getState().assignWheel(motor.id);
    useRobotStore.getState().selectMotorCatalogueItem("high-torque-dc");
    useRobotStore.getState().replaceMotor("front-left");

    const replacedMotor = useRobotStore
      .getState()
      .parts.find((part) => part.id === motor.id);
    const wheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    const definition = wheelCatalogue.find(
      (item) => item.id === "standard-rubber"
    );
    expect(replacedMotor?.motorCatalogueId).toBe("high-torque-dc");
    expect(wheel).toBeDefined();
    expect(definition).toBeDefined();
    if (!replacedMotor || !wheel || !definition) return;
    expect(wheel.position).toEqual(
      getWheelWorldMountTransform(replacedMotor, definition).position
    );

    useRobotStore.getState().selectWheelCatalogueItem("heavy-duty");
    useRobotStore.getState().assignWheel(motor.id);
    useRobotStore.getState().selectMotorCatalogueItem("small-dc");
    useRobotStore.getState().replaceMotor("front-left");
    expect(
      useRobotStore.getState().parts.some((part) => part.type === "Wheel")
    ).toBe(false);
    expect(
      useRobotStore
        .getState()
        .connections.some((connection) => connection.type === "Motor-Wheel")
    ).toBe(false);
  });

  it("removes wheel assignments with wheels or their parent motor", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().selectMotorCatalogueItem("high-torque-dc");
    useRobotStore.getState().selectMountZone("front-left");
    useRobotStore.getState().placeMotor();
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    if (!motor) return;

    useRobotStore.getState().selectWheelCatalogueItem("small-omni");
    useRobotStore.getState().selectWheelMotor(motor.id);
    useRobotStore.getState().assignWheel(motor.id);
    expect(
      useRobotStore.getState().parts.filter((part) => part.type === "Wheel")
    ).toHaveLength(0);

    useRobotStore.getState().selectWheelCatalogueItem("heavy-duty");
    useRobotStore.getState().assignWheel(motor.id);
    expect(
      useRobotStore.getState().parts.filter((part) => part.type === "Wheel")
    ).toHaveLength(1);
    useRobotStore.getState().removeWheel(motor.id);
    expect(
      useRobotStore.getState().connections.some(
        (connection) => connection.type === "Motor-Wheel"
      )
    ).toBe(false);

    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().assignWheel(motor.id);
    useRobotStore.getState().removeMotor("front-left");
    expect(
      useRobotStore.getState().parts.some((part) => part.id === motor.id)
    ).toBe(false);
    expect(
      useRobotStore.getState().parts.some((part) => part.type === "Wheel")
    ).toBe(false);
    expect(useRobotStore.getState().connections).toHaveLength(0);
  });

  it("keeps wheel configuration when navigating to and from the completion stage", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().selectMotorCatalogueItem("small-dc");
    useRobotStore.getState().selectMountZone("front-left");
    useRobotStore.getState().placeMotor();
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    if (!motor) return;

    useRobotStore.getState().setStage("wheels");
    useRobotStore.getState().selectWheelCatalogueItem("grip");
    useRobotStore.getState().selectWheelMotor(motor.id);
    useRobotStore.getState().assignWheel(motor.id);
    useRobotStore.getState().selectMotorCatalogueItem("small-dc");
    useRobotStore.getState().selectMountZone("front-right");
    useRobotStore.getState().placeMotor();
    const rightMotor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-right");
    if (!rightMotor) return;
    useRobotStore.getState().assignWheel(rightMotor.id);
    useRobotStore.getState().setStage("drivetrain");
    useRobotStore.getState().finishBuild();
    expect(useRobotStore.getState().stage).toBe("completed");

    useRobotStore.getState().setStage("motors");
    useRobotStore.getState().setStage("wheels");
    expect(useRobotStore.getState().selectedWheelCatalogueId).toBe("grip");
    expect(
      useRobotStore
        .getState()
        .parts.find((part) => part.type === "Wheel")?.wheelCatalogueId
    ).toBe("grip");
  });

  it("initializes wheel dimensions from the selected preset", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().selectWheelCatalogueItem("heavy-duty");

    expect(useRobotStore.getState().selectedWheelDiameterCm).toBe(28);
    expect(useRobotStore.getState().selectedWheelWidthCm).toBe(10);

    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
    useRobotStore.getState().selectMountZone("front-left");
    useRobotStore.getState().placeMotor();
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    if (!motor) return;
    useRobotStore.getState().selectWheelMotor(motor.id);
    useRobotStore.getState().assignWheel(motor.id);
    const wheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    expect(wheel?.wheelCatalogueId).toBe("heavy-duty");
    expect(wheel?.wheelDiameter).toBe(0.28);
    expect(wheel?.wheelWidth).toBe(0.1);
  });

  it("updates custom dimensions and shaft alignment on only the selected wheel", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    for (const zoneId of ["front-left", "rear-left"]) {
      useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
      useRobotStore.getState().selectMountZone(zoneId);
      useRobotStore.getState().placeMotor();
    }
    const motors = useRobotStore
      .getState()
      .parts.filter((part) => part.type === "Motor");
    const firstMotor = motors.find((part) => part.mountingZoneId === "front-left");
    const secondMotor = motors.find((part) => part.mountingZoneId === "rear-left");
    if (!firstMotor || !secondMotor) return;

    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().selectWheelMotor(firstMotor.id);
    useRobotStore.getState().assignWheel(firstMotor.id);
    useRobotStore.getState().selectWheelMotor(secondMotor.id);
    useRobotStore.getState().assignWheel(secondMotor.id);

    const firstWheelId = useRobotStore
      .getState()
      .connections.find((connection) => connection.parentId === firstMotor.id)
      ?.childId;
    const secondWheelId = useRobotStore
      .getState()
      .connections.find((connection) => connection.parentId === secondMotor.id)
      ?.childId;
    expect(firstWheelId).toBeDefined();
    expect(secondWheelId).toBeDefined();
    if (!firstWheelId || !secondWheelId) return;
    const firstConnection = useRobotStore
      .getState()
      .connections.find((connection) => connection.childId === firstWheelId);
    const secondConnection = useRobotStore
      .getState()
      .connections.find((connection) => connection.childId === secondWheelId);

    useRobotStore.getState().updateSelectedWheelDimensions({
      diameterCm: 34,
      widthCm: 12,
    });

    const state = useRobotStore.getState();
    const firstWheel = state.parts.find((part) => part.id === firstWheelId);
    const secondWheel = state.parts.find((part) => part.id === secondWheelId);
    const updatedConnection = state.connections.find(
      (connection) => connection.childId === secondWheelId
    );
    expect(firstWheel?.wheelDiameter).toBe(0.22);
    expect(firstWheel?.wheelWidth).toBe(0.07);
    expect(secondWheel?.wheelDiameter).toBe(0.34);
    expect(secondWheel?.wheelWidth).toBe(0.12);
    expect(secondWheel?.size).toEqual([0.17, 0.12, 0.17]);
    expect(updatedConnection?.id).toBe(secondConnection?.id);
    expect(updatedConnection?.relativePosition).toEqual(
      getWheelWorldMountTransform(secondMotor, {
        ...wheelCatalogue.find((wheel) => wheel.id === "standard-rubber")!,
        width: 0.12,
      }).relativePosition
    );
    expect(firstConnection?.relativePosition).toEqual(
      getWheelWorldMountTransform(
        firstMotor,
        wheelCatalogue.find((wheel) => wheel.id === "standard-rubber")!
      ).relativePosition
    );
  });

  it("persists wheel instance dimensions and attachment through stage navigation", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
    useRobotStore.getState().selectMountZone("front-left");
    useRobotStore.getState().placeMotor();
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    if (!motor) return;

    useRobotStore.getState().selectWheelCatalogueItem("grip");
    useRobotStore.getState().selectWheelMotor(motor.id);
    useRobotStore.getState().updateSelectedWheelDimensions({
      diameterCm: 31,
      widthCm: 11,
    });
    useRobotStore.getState().assignWheel(motor.id);
    const wheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    if (!wheel) return;

    useRobotStore.getState().setStage("motors");
    useRobotStore.getState().setStage("wheels");
    const persistedWheel = useRobotStore
      .getState()
      .parts.find((part) => part.id === wheel.id);
    expect(persistedWheel?.wheelCatalogueId).toBe("grip");
    expect(persistedWheel?.wheelDiameter).toBe(0.31);
    expect(persistedWheel?.wheelWidth).toBe(0.11);
    expect(
      useRobotStore
        .getState()
        .connections.some(
          (connection) =>
            connection.parentId === motor.id && connection.childId === wheel.id
        )
    ).toBe(true);
  });

  it("replaces a wheel with preset dimensions and preserves its attachment", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
    useRobotStore.getState().selectMountZone("front-left");
    useRobotStore.getState().placeMotor();
    const motor = useRobotStore
      .getState()
      .parts.find((part) => part.mountingZoneId === "front-left");
    if (!motor) return;

    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().selectWheelMotor(motor.id);
    useRobotStore.getState().assignWheel(motor.id);
    const originalConnection = useRobotStore
      .getState()
      .connections.find((connection) => connection.parentId === motor.id);
    useRobotStore.getState().updateSelectedWheelDimensions({
      diameterCm: 40,
      widthCm: 15,
    });

    useRobotStore.getState().selectWheelCatalogueItem("heavy-duty");
    useRobotStore.getState().assignWheel(motor.id);
    const replacedWheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    const replacedConnection = useRobotStore
      .getState()
      .connections.find((connection) => connection.parentId === motor.id);

    expect(replacedWheel?.id).toBe(originalConnection?.childId);
    expect(replacedWheel?.wheelCatalogueId).toBe("heavy-duty");
    expect(replacedWheel?.wheelDiameter).toBe(0.28);
    expect(replacedWheel?.wheelWidth).toBe(0.1);
    expect(replacedConnection?.id).toBe(originalConnection?.id);
    expect(replacedConnection?.childId).toBe(replacedWheel?.id);
  });

  it("clamps dimensions to supported bounds and preserves valid values for non-finite input", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().updateSelectedWheelDimensions({
      diameterCm: 2,
      widthCm: 25,
    });
    expect(useRobotStore.getState().selectedWheelDiameterCm).toBe(8);
    expect(useRobotStore.getState().selectedWheelWidthCm).toBe(20);

    useRobotStore.getState().updateSelectedWheelDimensions({
      diameterCm: 80,
      widthCm: Number.NaN,
    });
    expect(useRobotStore.getState().selectedWheelDiameterCm).toBe(60);
    expect(useRobotStore.getState().selectedWheelWidthCm).toBe(20);

    expect(
      clampWheelDimension(2, 22, wheelDimensionBounds.diameterCm)
    ).toBe(8);
    expect(
      clampWheelDimension(80, 22, wheelDimensionBounds.diameterCm)
    ).toBe(60);
    expect(
      clampWheelDimension(1, 7, wheelDimensionBounds.widthCm)
    ).toBe(3);
    expect(
      clampWheelDimension(25, 7, wheelDimensionBounds.widthCm)
    ).toBe(20);
    expect(
      clampWheelDimension(Number.NaN, 7, wheelDimensionBounds.widthCm)
    ).toBe(7);
    expect(
      getWheelDimensionsInMeters({ diameterCm: 8, widthCm: 3 })
    ).toEqual({ diameter: 0.08, width: 0.03 });
  });

  it("automatically maps differential and 4-wheel differential drive by mounting side", () => {
    const motors = installMotorWheelAssemblies();
    useRobotStore.getState().setStage("drivetrain");
    let configuration = useRobotStore.getState().drivetrain;
    const motorAt = (zoneId: string) =>
      motors.find((motor) => motor.mountingZoneId === zoneId);
    const wheelFor = (motorId: string) =>
      useRobotStore
        .getState()
        .connections.find(
          (connection) =>
            connection.type === "Motor-Wheel" &&
            connection.parentId === motorId
        )?.childId;

    expect(configuration.type).toBe("differential-2");
    expect(configuration.left[0]).toEqual({
      motorId: motorAt("front-left")?.id,
      wheelId: wheelFor(motorAt("front-left")?.id ?? ""),
    });
    expect(configuration.right[0]).toEqual({
      motorId: motorAt("front-right")?.id,
      wheelId: wheelFor(motorAt("front-right")?.id ?? ""),
    });

    useRobotStore.getState().setDrivetrainType("differential-4");
    configuration = useRobotStore.getState().drivetrain;
    expect(configuration.left).toEqual([
      {
        motorId: motorAt("front-left")?.id,
        wheelId: wheelFor(motorAt("front-left")?.id ?? ""),
      },
      {
        motorId: motorAt("rear-left")?.id,
        wheelId: wheelFor(motorAt("rear-left")?.id ?? ""),
      },
    ]);
    expect(configuration.right).toEqual([
      {
        motorId: motorAt("front-right")?.id,
        wheelId: wheelFor(motorAt("front-right")?.id ?? ""),
      },
      {
        motorId: motorAt("rear-right")?.id,
        wheelId: wheelFor(motorAt("rear-right")?.id ?? ""),
      },
    ]);
    useRobotStore.getState().setDrivetrainType("differential-2");
    configuration = useRobotStore.getState().drivetrain;
    expect(configuration.left).toEqual([
      {
        motorId: motorAt("front-left")?.id,
        wheelId: wheelFor(motorAt("front-left")?.id ?? ""),
      },
    ]);
    expect(configuration.right).toEqual([
      {
        motorId: motorAt("front-right")?.id,
        wheelId: wheelFor(motorAt("front-right")?.id ?? ""),
      },
    ]);
    useRobotStore.getState().setDrivetrainType("differential-4");
    useRobotStore.getState().finishBuild();
    expect(useRobotStore.getState().stage).toBe("completed");
  });

  it("does not allow completion through stage navigation with an invalid drivetrain", () => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    useRobotStore.getState().setStage("completed");

    expect(useRobotStore.getState().stage).toBe("battery");
  });

  it("supports manual mapping and requires confirmation before replacing it", () => {
    const motors = installMotorWheelAssemblies();
    useRobotStore.getState().setStage("drivetrain");
    const motorAt = (zoneId: string) =>
      motors.find((motor) => motor.mountingZoneId === zoneId);
    const assignmentFor = (zoneId: string) => {
      const motor = motorAt(zoneId);
      if (!motor) return null;
      const wheelId = useRobotStore
        .getState()
        .connections.find(
          (connection) => connection.parentId === motor.id
        )?.childId;
      return wheelId ? { motorId: motor.id, wheelId } : null;
    };
    const rearLeft = assignmentFor("rear-left");
    expect(rearLeft).not.toBeNull();
    if (!rearLeft) return;

    useRobotStore.getState().setDrivetrainAssignment("left", 0, rearLeft);
    useRobotStore.getState().setDrivetrainAssignment("right", 0, rearLeft);
    let configuration = useRobotStore.getState().drivetrain;
    expect(configuration.mappingCustomized).toBe(true);
    expect(configuration.left[0]).toBeNull();
    expect(configuration.right[0]).toEqual(rearLeft);
    useRobotStore.getState().setStage("wheels");
    useRobotStore.getState().setStage("drivetrain");
    expect(useRobotStore.getState().drivetrain.right[0]).toEqual(rearLeft);
    expect(
      useRobotStore.getState().applySuggestedDrivetrainMapping()
    ).toBe(false);
    expect(useRobotStore.getState().drivetrain.right[0]).toEqual(rearLeft);

    useRobotStore.getState().setDrivetrainType("differential-4");
    configuration = useRobotStore.getState().drivetrain;
    expect(configuration.left[0]).toBeNull();
    expect(configuration.left[1]).toBeNull();
    expect(configuration.right[0]).toEqual(rearLeft);
    expect(configuration.mappingCustomized).toBe(true);

    expect(
      useRobotStore.getState().applySuggestedDrivetrainMapping(true)
    ).toBe(true);
    configuration = useRobotStore.getState().drivetrain;
    expect(configuration.mappingCustomized).toBe(false);
    expect(configuration.left.map((assignment) => assignment?.motorId)).toEqual([
      motorAt("front-left")?.id,
      motorAt("rear-left")?.id,
    ]);
  });

  it("requires confirmation before a type change discards custom drive slots", () => {
    const motors = installMotorWheelAssemblies();
    useRobotStore.getState().setDrivetrainType("differential-4");
    const rearLeft = motors.find(
      (motor) => motor.mountingZoneId === "rear-left"
    );
    if (!rearLeft) return;
    const rearLeftWheelId = useRobotStore
      .getState()
      .connections.find(
        (connection) => connection.parentId === rearLeft.id
      )?.childId;
    if (!rearLeftWheelId) return;

    useRobotStore.getState().setDrivetrainAssignment("left", 1, {
      motorId: rearLeft.id,
      wheelId: rearLeftWheelId,
    });
    expect(
      useRobotStore.getState().setDrivetrainType("differential-2")
    ).toBe(false);
    expect(useRobotStore.getState().drivetrain.type).toBe("differential-4");

    expect(
      useRobotStore.getState().setDrivetrainType("differential-2", true)
    ).toBe(true);
    const configuration = useRobotStore.getState().drivetrain;
    expect(configuration.type).toBe("differential-2");
    expect(configuration.left).toHaveLength(1);
    expect(configuration.left[0]?.motorId).toBe(
      motors.find((motor) => motor.mountingZoneId === "front-left")?.id
    );
  });

  it("cleans drivetrain assignments when powered wheels or motors are removed", () => {
    const motors = installMotorWheelAssemblies([
      "front-left",
      "front-right",
    ]);
    useRobotStore.getState().setStage("drivetrain");
    const leftMotor = motors.find(
      (motor) => motor.mountingZoneId === "front-left"
    );
    expect(leftMotor).toBeDefined();
    if (!leftMotor) return;

    useRobotStore.getState().removeWheel(leftMotor.id);
    let configuration = useRobotStore.getState().drivetrain;
    expect(configuration.left[0]).toBeNull();
    expect(configuration.right[0]).not.toBeNull();

    useRobotStore.getState().removeMotor("front-right");
    configuration = useRobotStore.getState().drivetrain;
    expect(configuration.right[0]).toBeNull();
  });

  it("clears a drivetrain assignment when its motor-wheel connection is disconnected", () => {
    const motors = installMotorWheelAssemblies([
      "front-left",
      "front-right",
    ]);
    useRobotStore.getState().setStage("drivetrain");
    const leftMotor = motors.find(
      (motor) => motor.mountingZoneId === "front-left"
    );
    if (!leftMotor) return;
    const connection = useRobotStore
      .getState()
      .connections.find(
        (item) =>
          item.type === "Motor-Wheel" && item.parentId === leftMotor.id
      );
    expect(connection).toBeDefined();
    if (!connection) return;

    useRobotStore.getState().disconnectParts(connection.id);
    const state = useRobotStore.getState();
    expect(state.drivetrain.left[0]).toBeNull();
    expect(state.drivetrain.right[0]).not.toBeNull();
  });

  it("preserves valid mappings on foundation rebuild and resets them on foundation deletion", () => {
    installMotorWheelAssemblies(["front-left", "front-right"]);
    useRobotStore.getState().setStage("drivetrain");
    const before = useRobotStore.getState().drivetrain;
    useRobotStore.getState().updateFoundationDimensions({
      length: 1.2,
      width: 1,
    });
    expect(useRobotStore.getState().drivetrain).toEqual(before);

    useRobotStore.getState().setSelectedId("foundation-chassis");
    useRobotStore.getState().deleteSelected();
    expect(useRobotStore.getState().drivetrain).toEqual({
      type: "differential-2",
      left: [null],
      right: [null],
      mappingCustomized: false,
    });
  });

  it("places the front bumper on the front face along +X", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.setFoundationOptions({ includeFrontCover: true });
    store.confirmFoundation();

    const foundation = useRobotStore.getState().foundation!;
    const bumper = useRobotStore
      .getState()
      .parts.find((part) => part.id === "foundation-front-cover");

    expect(bumper).toBeDefined();
    if (!bumper) return;

    expect(bumper.position[0]).toBeCloseTo(foundation.length * 0.5 + 0.06);
    expect(bumper.position[1]).toBeCloseTo(foundation.height * 0.5);
    expect(bumper.position[2]).toBeCloseTo(0);
    expect(bumper.size[0]).toBeCloseTo(0.12);
    expect(bumper.size[1]).toBeCloseTo(foundation.height * 0.55);
    expect(bumper.size[2]).toBeCloseTo(foundation.width * 0.9);
  });

  it("orients motors on +Z to face outward toward +Z and -Z to face outward toward -Z", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();
    const foundation = useRobotStore.getState().foundation!;
    const zones = generateMotorMountZones(foundation);

    const frontLeftZone = zones.find((z) => z.id === "front-left")!;
    const rearLeftZone = zones.find((z) => z.id === "rear-left")!;
    const frontRightZone = zones.find((z) => z.id === "front-right")!;
    const rearRightZone = zones.find((z) => z.id === "rear-right")!;

    expect(frontLeftZone.rotation[1]).toBeCloseTo(-Math.PI / 2);
    expect(rearLeftZone.rotation[1]).toBeCloseTo(-Math.PI / 2);
    expect(frontRightZone.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(rearRightZone.rotation[1]).toBeCloseTo(Math.PI / 2);

    store.selectMotorCatalogueItem("standard-dc");
    store.selectMountZone("front-left");
    store.placeMotor();
    store.selectMountZone("front-right");
    store.placeMotor();

    const leftMotor = useRobotStore
      .getState()
      .parts.find((p) => p.mountingZoneId === "front-left")!;
    const rightMotor = useRobotStore
      .getState()
      .parts.find((p) => p.mountingZoneId === "front-right")!;

    const leftShaftPos = getMotorShaftMountPosition(leftMotor);
    const rightShaftPos = getMotorShaftMountPosition(rightMotor);

    expect(leftShaftPos[2]).toBeGreaterThan(leftMotor.position[2]);
    expect(leftShaftPos[0]).toBeCloseTo(leftMotor.position[0]);

    expect(rightShaftPos[2]).toBeLessThan(rightMotor.position[2]);
    expect(rightShaftPos[0]).toBeCloseTo(rightMotor.position[0]);
  });

  it("aligns wheel axes with the lateral axis (+Z / -Z) and positions wheels outward", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();

    store.selectMotorCatalogueItem("standard-dc");
    store.selectMountZone("front-left");
    store.placeMotor();
    store.selectMountZone("front-right");
    store.placeMotor();

    const leftMotor = useRobotStore
      .getState()
      .parts.find((p) => p.mountingZoneId === "front-left")!;
    const rightMotor = useRobotStore
      .getState()
      .parts.find((p) => p.mountingZoneId === "front-right")!;

    store.selectWheelCatalogueItem("standard-rubber");
    store.selectWheelMotor(leftMotor.id);
    store.assignWheel(leftMotor.id);

    store.selectWheelMotor(rightMotor.id);
    store.assignWheel(rightMotor.id);

    const parts = useRobotStore.getState().parts;
    const connections = useRobotStore.getState().connections;

    const leftWheelId = connections.find((c) => c.parentId === leftMotor.id)?.childId;
    const rightWheelId = connections.find((c) => c.parentId === rightMotor.id)?.childId;

    const leftWheel = parts.find((p) => p.id === leftWheelId)!;
    const rightWheel = parts.find((p) => p.id === rightWheelId)!;

    expect(leftWheel.position[2]).toBeGreaterThan(leftMotor.position[2]);
    expect(leftWheel.position[0]).toBeCloseTo(leftMotor.position[0]);
    expect(leftWheel.rotation[1]).toBeCloseTo(-Math.PI / 2);

    expect(rightWheel.position[2]).toBeLessThan(rightMotor.position[2]);
    expect(rightWheel.position[0]).toBeCloseTo(rightMotor.position[0]);
    expect(rightWheel.rotation[1]).toBeCloseTo(Math.PI / 2);
  });

  it("preserves motor rotation interaction relative to mounting baseline and updates wheel alignment", () => {
    const store = useRobotStore.getState();
    store.startNewBuild();
    store.confirmFoundation();

    store.selectMotorCatalogueItem("standard-dc");
    store.selectMountZone("front-right");
    store.placeMotor();

    const motor = useRobotStore
      .getState()
      .parts.find((p) => p.mountingZoneId === "front-right")!;
    expect(motor.rotation[1]).toBeCloseTo(Math.PI / 2);

    store.selectWheelCatalogueItem("standard-rubber");
    store.selectWheelMotor(motor.id);
    store.assignWheel(motor.id);

    let currentMotor = useRobotStore
      .getState()
      .parts.find((p) => p.id === motor.id)!;
    let wheel = useRobotStore
      .getState()
      .parts.find((p) => p.type === "Wheel")!;
    expect(wheel.position[2]).toBeLessThan(currentMotor.position[2]);

    store.rotateMotor("front-right");

    currentMotor = useRobotStore
      .getState()
      .parts.find((p) => p.id === motor.id)!;
    wheel = useRobotStore
      .getState()
      .parts.find((p) => p.type === "Wheel")!;

    expect(currentMotor.rotation[1]).toBeCloseTo(Math.PI / 2 + Math.PI);
    expect(wheel.rotation[1]).toBeCloseTo(currentMotor.rotation[1]);
    expect(wheel.position[2]).toBeGreaterThan(currentMotor.position[2]);

    store.rotateMotor("front-right");

    currentMotor = useRobotStore
      .getState()
      .parts.find((p) => p.id === motor.id)!;
    wheel = useRobotStore
      .getState()
      .parts.find((p) => p.type === "Wheel")!;

    expect(currentMotor.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(wheel.rotation[1]).toBeCloseTo(currentMotor.rotation[1]);
    expect(wheel.position[2]).toBeLessThan(currentMotor.position[2]);
  });
});
