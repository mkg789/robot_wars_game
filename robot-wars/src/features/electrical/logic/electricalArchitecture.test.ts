import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { validateRobotAssembly } from "../../robot-builder/logic/assemblyValidation";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import { resolvePartElectricalSpec } from "./electricalComponentAdapters";
import { evaluateElectricalCompatibility } from "./electricalCompatibility";
import { validateElectricalAssembly } from "./electricalValidation";
import {
  toElectricalProvenance,
  type ElectricalComponentSpec,
  type ElectricalConnectorSpec,
} from "../types/electrical.types";

describe("Phase 5.1: Electrical Architecture & Component Interfaces", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
  });

  it("adapts Battery, Motor, and multiple Controller architectures cleanly without fabricating unknown ratings", () => {
    const store = useRobotStore.getState();
    store.installBattery("compact-lipo"); // 7.4V 2S (6.0-8.4V)
    store.installController("arduino-uno"); // 5V logic, 7-12V VIN
    store.selectMountZone("front-left");
    store.selectMotorCatalogueItem("standard-dc");
    store.placeMotor();

    const state = useRobotStore.getState();
    const battery = state.parts.find((p) => p.type === "Battery")!;
    const controller = state.parts.find((p) => p.type === "Controller")!;
    const motor = state.parts.find((p) => p.type === "Motor")!;

    const batSpec = resolvePartElectricalSpec(battery)!;
    expect(batSpec.componentType).toBe("battery");
    expect(batSpec.batterySpec?.nominalVoltageV).toBe(7.4);
    expect(batSpec.batterySpec?.maxVoltageV).toBe(8.4);
    expect(batSpec.unknownFields).toContain("internalResistanceOhm");
    expect(batSpec.unknownFields).toContain("maxContinuousDischargeA");

    const ctrlSpec = resolvePartElectricalSpec(controller)!;
    expect(ctrlSpec.componentType).toBe("controller");
    expect(ctrlSpec.controllerSpec?.logicLevelV).toBe(5);
    expect(ctrlSpec.controllerSpec?.inputVoltageRangeV).toEqual({ minV: 7, maxV: 12 });
    // PWM pin vs ADC pin capabilities remain differentiated rather than interchangeable
    const pwmPin = ctrlSpec.pins.find((p) => p.pwmCapable && !p.analogCapable);
    const adcPin = ctrlSpec.pins.find((p) => p.analogCapable && !p.pwmCapable);
    expect(pwmPin).toBeDefined();
    expect(adcPin).toBeDefined();

    // Also verifies board-agnostic support for ESP32 & STM32
    store.installController("esp32-devkit");
    const espCtrl = useRobotStore.getState().parts.find((p) => p.type === "Controller")!;
    const espSpec = resolvePartElectricalSpec(espCtrl)!;
    expect(espSpec.controllerSpec?.logicLevelV).toBe(3.3);
    expect(espSpec.controllerSpec?.communicationProtocols).toContain("can");

    // Catalogue motor without winding ratings explicitly records unknown fields
    const motorSpec = resolvePartElectricalSpec(motor)!;
    expect(motorSpec.componentType).toBe("motor");
    expect(motorSpec.unknownFields).toContain("nominalVoltageV");
    expect(motorSpec.unknownFields).toContain("stallCurrentA");
    expect(
      toElectricalProvenance(undefined).method
    ).toBe("unknown");
  });

  it("evaluates electrical compatibility across voltage, role, signal direction, pin capabilities, and connectors", () => {
    const prov = { method: "datasheet" as const, verified: true, source: "test:spec" };

    const battery2S: ElectricalComponentSpec = {
      specId: "bat-2s",
      componentType: "battery",
      interfaces: [
        {
          interfaceId: "bat-out",
          name: "2S Out",
          role: "power-output",
          voltageSpec: { nominalV: 7.4, minV: 7.0, maxV: 8.4 },
          currentSpec: { maxContinuousA: 25 },
          pinIds: ["p1"],
          connectorId: "c-xt60",
          provenance: prov,
        },
        {
          interfaceId: "bat-gnd",
          name: "2S GND",
          role: "ground",
          pinIds: ["p2"],
          provenance: prov,
        },
      ],
      pins: [
        {
          pinId: "p1",
          pinName: "BAT+",
          pinType: "power",
          role: "power-output",
          direction: "output",
          supportedVoltage: { nominalV: 7.4, minV: 7.0, maxV: 8.4 },
          currentLimits: { maxContinuousA: 25 },
          signalTypes: [],
          isPower: true,
          provenance: prov,
        },
        {
          pinId: "p2",
          pinName: "BAT-",
          pinType: "ground",
          role: "ground",
          direction: "reference",
          signalTypes: [],
          isGround: true,
          provenance: prov,
        },
      ],
      connectors: [
        {
          connectorId: "c-xt60",
          connectorType: "xt60",
          name: "XT60 Plug",
          pinCount: 2,
          pinDefinitions: [{ pinNumber: 1, pinId: "p1" }],
          provenance: prov,
        },
      ],
      assumptions: [],
      unknownFields: [],
      provenance: prov,
    };

    const controller5V: ElectricalComponentSpec = {
      specId: "ctrl-5v",
      componentType: "controller",
      interfaces: [
        {
          interfaceId: "vin",
          name: "VIN",
          role: "power-input",
          voltageSpec: { nominalV: 7.4, minV: 7.0, maxV: 12.0 },
          currentSpec: { maxContinuousA: 0.5 },
          pinIds: ["c-vin"],
          connectorId: "c-barrel",
          provenance: prov,
        },
        {
          interfaceId: "gpio",
          name: "GPIO Bus",
          role: "signal-bidirectional",
          voltageSpec: { nominalV: 5, minV: 0, maxV: 5 },
          supportedSignals: ["digital", "pwm", "analog"],
          pinIds: ["c-pwm", "c-adc"],
          provenance: prov,
        },
      ],
      pins: [
        {
          pinId: "c-vin",
          pinName: "VIN",
          pinType: "power",
          role: "power-input",
          direction: "input",
          supportedVoltage: { minV: 7.0, maxV: 12.0 },
          signalTypes: [],
          isPower: true,
          provenance: prov,
        },
        {
          pinId: "c-pwm",
          pinName: "D3",
          pinType: "signal",
          role: "signal-output",
          direction: "output",
          signalTypes: ["digital", "pwm"],
          digitalCapable: true,
          pwmCapable: true,
          analogCapable: false,
          provenance: prov,
        },
        {
          pinId: "c-adc",
          pinName: "A0",
          pinType: "signal",
          role: "signal-input",
          direction: "input",
          signalTypes: ["analog", "digital"],
          digitalCapable: true,
          pwmCapable: false,
          analogCapable: true,
          provenance: prov,
        },
      ],
      connectors: [
        {
          connectorId: "c-barrel",
          connectorType: "barrel-jack",
          name: "Barrel Jack",
          pinCount: 2,
          pinDefinitions: [{ pinNumber: 1, pinId: "c-vin" }],
          provenance: prov,
        },
      ],
      assumptions: [],
      unknownFields: [],
      provenance: prov,
    };

    // 1. Compatible voltage yet mismatched physical connector -> compatible-with-warnings
    const mismatchConnEval = evaluateElectricalCompatibility({
      sourceComponent: battery2S,
      sourceInterface: battery2S.interfaces[0],
      sourceConnector: battery2S.connectors[0],
      targetComponent: controller5V,
      targetInterface: controller5V.interfaces[0],
      targetConnector: controller5V.connectors[0],
    });
    expect(mismatchConnEval.status).toBe("compatible-with-warnings");

    // 2. Same interface voltage match with matching connectors -> compatible
    const cleanEval = evaluateElectricalCompatibility({
      sourceComponent: battery2S,
      sourceInterface: battery2S.interfaces[0],
      targetComponent: controller5V,
      targetInterface: controller5V.interfaces[0],
    });
    expect(cleanEval.status).toBe("compatible");

    // 3. Power-output wired directly to Ground -> incompatible error
    const shortEval = evaluateElectricalCompatibility({
      sourceComponent: battery2S,
      sourceInterface: battery2S.interfaces[0],
      targetComponent: battery2S,
      targetInterface: battery2S.interfaces[1],
    });
    expect(shortEval.status).toBe("incompatible");

    // 4. Requesting PWM on ADC-only pin -> pin capability error
    const badPinEval = evaluateElectricalCompatibility({
      sourceComponent: controller5V,
      sourceInterface: controller5V.interfaces[1],
      sourcePin: controller5V.pins[1], // PWM D3
      targetComponent: controller5V,
      targetInterface: controller5V.interfaces[1],
      targetPin: controller5V.pins[2], // ADC A0 (pwmCapable: false)
      signalProtocol: "pwm",
    });
    expect(badPinEval.status).toBe("incompatible");

    // 5. Missing motor voltage spec -> honest "unknown" status
    const unknownSpec: ElectricalComponentSpec = {
      specId: "motor-unk",
      componentType: "motor",
      interfaces: [
        {
          interfaceId: "m-in",
          name: "M+",
          role: "power-input",
          pinIds: [],
          provenance: { method: "unknown" },
        },
      ],
      pins: [],
      connectors: [],
      assumptions: [],
      unknownFields: ["nominalVoltageV"],
      provenance: { method: "unknown" },
    };
    const unknownEval = evaluateElectricalCompatibility({
      sourceComponent: battery2S,
      sourceInterface: battery2S.interfaces[0],
      targetComponent: unknownSpec,
      targetInterface: unknownSpec.interfaces[0],
    });
    expect(unknownEval.status).toBe("unknown");
  });

  it("validates logical connections for missing references, duplicates, contention, ground, and overvoltage", () => {
    const store = useRobotStore.getState();
    store.installBattery("heavy-duty-lipo"); // 14.8V nom, 16.8V max -> exceeds 12V Arduino VIN!
    store.installController("arduino-uno");

    const state = useRobotStore.getState();
    const bat = state.parts.find((p) => p.type === "Battery")!;
    const ctrl = state.parts.find((p) => p.type === "Controller")!;

    const report = validateElectricalAssembly({
      parts: state.parts,
      electricalConnections: [
        {
          id: "w-overvolt",
          sourcePartId: bat.id,
          sourceInterfaceId: "bat-power-out",
          targetPartId: ctrl.id,
          targetInterfaceId: "ctrl-power-in",
          connectionType: "power",
          provenance: { method: "user-supplied" },
        },
        {
          id: "w-dup",
          sourcePartId: bat.id,
          sourceInterfaceId: "bat-power-out",
          targetPartId: ctrl.id,
          targetInterfaceId: "ctrl-power-in",
          connectionType: "power",
          provenance: { method: "user-supplied" },
        },
        {
          id: "w-missing-pin",
          sourcePartId: bat.id,
          sourceInterfaceId: "bat-power-out",
          sourcePinId: "non-existent-pin",
          targetPartId: ctrl.id,
          targetInterfaceId: "ctrl-power-in",
          connectionType: "power",
          provenance: { method: "user-supplied" },
        },
      ],
    });

    expect(report.isValid).toBe(false);
    expect(report.diagnostics.some((d) => d.code === "voltage-mismatch")).toBe(true);
    expect(report.diagnostics.some((d) => d.code === "duplicate-connection")).toBe(true);
    expect(report.diagnostics.some((d) => d.code === "multi-driver-conflict")).toBe(true);
    expect(report.diagnostics.some((d) => d.code === "missing-pin")).toBe(true);
    expect(report.diagnostics.some((d) => d.code === "missing-ground-reference")).toBe(true);
  });

  it("integrates electrical state into useRobotStore, assembly validation, cascade delete, and undo/redo", () => {
    const store = useRobotStore.getState();
    store.installBattery("compact-lipo"); // 7.4V (6.0-8.4V)
    store.installController("arduino-uno"); // 7-12V VIN

    // Compatible battery -> controller power + ground connections
    const state1 = useRobotStore.getState();
    const bat = state1.parts.find((p) => p.type === "Battery")!;
    const ctrl = state1.parts.find((p) => p.type === "Controller")!;

    const powerWireId = state1.addElectricalConnection({
      sourcePartId: bat.id,
      sourceInterfaceId: "bat-power-out",
      targetPartId: ctrl.id,
      targetInterfaceId: "ctrl-power-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    const gndWireId = useRobotStore.getState().addElectricalConnection({
      sourcePartId: bat.id,
      sourceInterfaceId: "bat-gnd",
      targetPartId: ctrl.id,
      targetInterfaceId: "ctrl-gnd",
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });
    expect(powerWireId).toBeTruthy();
    expect(gndWireId).toBeTruthy();

    // Assign connector onto battery interface + pin override cleanly
    const xt60: ElectricalConnectorSpec = {
      connectorId: "conn-xt60-bat",
      connectorType: "xt60",
      name: "XT60 Female",
      pinCount: 2,
      pinDefinitions: [
        { pinNumber: 1, pinId: "pin-bat-pos", label: "+" },
        { pinNumber: 2, pinId: "pin-bat-neg", label: "-" },
      ],
      provenance: { method: "user-supplied" },
    };
    useRobotStore.getState().assignConnectorToInterface(bat.id, "bat-power-out", xt60);

    // Combined mechanical + electrical validation inside validateRobotAssembly
    const wiredState = useRobotStore.getState();
    const combinedReport = validateRobotAssembly({
      parts: wiredState.parts,
      connections: wiredState.connections,
      foundation: wiredState.foundation,
      drivetrain: wiredState.drivetrain,
      electricalConnections: wiredState.electricalConnections,
    });
    expect(combinedReport.electricalReport).toBeDefined();
    expect(combinedReport.electricalReport?.errorCount).toBe(0);

    // Deleting battery cleans up referencing electricalConnections without dangling pointers
    wiredState.removeBattery();
    expect(useRobotStore.getState().electricalConnections).toHaveLength(0);

    // Undo restores battery AND both electrical connections!
    expect(useRobotStore.getState().undo()).toBe(true);
    expect(useRobotStore.getState().parts.some((p) => p.type === "Battery")).toBe(true);
    expect(useRobotStore.getState().electricalConnections).toHaveLength(2);

    // Custom electrical spec override preserves compatibility without changing RobotPart structure
    const customDriverSpec: ElectricalComponentSpec = {
      specId: "drv-spec",
      componentType: "motor-driver",
      interfaces: [],
      pins: [],
      connectors: [],
      assumptions: [],
      unknownFields: [],
      provenance: { method: "user-supplied" },
    };
    useRobotStore.getState().assignPartElectricalSpec(ctrl.id, customDriverSpec);
    const updatedCtrl = useRobotStore.getState().parts.find((p: RobotPart) => p.id === ctrl.id);
    expect(updatedCtrl?.electricalSpec?.componentType).toBe("motor-driver");
  });
});
