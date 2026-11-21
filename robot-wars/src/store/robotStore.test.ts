import { beforeEach, describe, expect, it } from "vitest";

import { initialParts } from "../features/robot-builder/data/initialRobot";
import { useRobotStore } from "./robotStore";
import {
  generateMotorMountZones,
  isMountZoneInsideFoundation,
} from "../features/robot-builder/logic/mountingZones";
import { wheelCatalogue } from "../features/robot-builder/data/wheelCatalogue";
import { getWheelWorldMountTransform } from "../features/robot-builder/logic/wheelMounting";

function resetStore() {
  useRobotStore.setState({
    parts: initialParts.map((part) => ({
      ...part,
      position: [...part.position] as [number, number, number],
      rotation: [...part.rotation] as [number, number, number],
      size: [...part.size] as [number, number, number],
    })),
    connections: [],
    selectedId: "chassis",
    transformMode: "select",
    foundation: null,
    foundationId: null,
    stage: "foundation",
    selectedMotorCatalogueId: null,
    selectedMountZoneId: null,
    selectedWheelCatalogueId: null,
    selectedWheelMotorId: null,
  });
}

describe("robot assembly store", () => {
  beforeEach(resetStore);

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

    useRobotStore.getState().rotateMotor("front-left", Math.PI);
    currentMotor = useRobotStore
      .getState()
      .parts.find((part) => part.id === motor.id);
    wheel = useRobotStore
      .getState()
      .parts.find((part) => part.type === "Wheel");
    expect(currentMotor).toBeDefined();
    expect(wheel).toBeDefined();
    if (!currentMotor || !wheel) return;
    expect(wheel.position[0]).toBeLessThan(currentMotor.position[0]);
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
});
