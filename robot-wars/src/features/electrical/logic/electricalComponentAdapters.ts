import { batteryCatalogue } from "../../robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../../robot-builder/data/controllerCatalogue";
import { motorCatalogue } from "../../robot-builder/data/motorCatalogue";
import { getElectricalCatalogueItem } from "../data/electricalCatalogue";
import {
  resolveBatteryEngineeringSpec,
  resolveControllerEngineeringSpec,
  resolveMotorEngineeringSpec,
} from "../../robot-builder/logic/engineeringAdapters";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import {
  toElectricalProvenance,
  type ElectricalComponentSpec,
  type ElectricalConnectorSpec,
  type ElectricalInterfaceSpec,
  type ElectricalPinSpec,
  type ElectricalSignalType,
} from "../types/electrical.types";

function buildBatteryElectricalComponentSpec(part: RobotPart): ElectricalComponentSpec {
  const catItem = part.batteryCatalogueId
    ? batteryCatalogue.find((b) => b.id === part.batteryCatalogueId)
    : undefined;
  const eng = resolveBatteryEngineeringSpec(part, catItem);
  const prov = toElectricalProvenance(eng.generalProvenance);

  const nominalV = eng.electrical?.nominalVoltageV;
  const maxV = eng.electrical?.fullyChargedVoltageV;
  const minV = eng.electrical?.cutoffVoltageV;
  const capacityMah = eng.electrical?.capacityMah;
  const maxContinuousDischargeA =
    eng.electrical?.continuousDischargeC !== undefined && capacityMah !== undefined
      ? (capacityMah / 1000) * eng.electrical.continuousDischargeC
      : undefined;
  const peakDischargeA =
    eng.electrical?.burstDischargeC !== undefined && capacityMah !== undefined
      ? (capacityMah / 1000) * eng.electrical.burstDischargeC
      : undefined;

  const unknownFields: string[] = [];
  if (maxContinuousDischargeA === undefined) unknownFields.push("maxContinuousDischargeA");
  if (eng.electrical?.internalResistanceOhm === undefined) {
    unknownFields.push("internalResistanceOhm");
  }
  if (!eng.connector) unknownFields.push("connector.type");

  const connectorId = "conn-bat-main";
  const connectors: ElectricalConnectorSpec[] = [
    {
      connectorId,
      connectorType: eng.connector?.type ?? "unknown",
      name: eng.connector ? `${eng.connector.type.toUpperCase()} Discharge Lead` : "Unspecified Discharge Connector",
      pinCount: 2,
      pinLayout: "2-pin (+ / -)",
      pinDefinitions: [
        { pinNumber: 1, pinId: "pin-bat-pos", label: "BAT+" },
        { pinNumber: 2, pinId: "pin-bat-neg", label: "BAT-" },
      ],
      ratedCurrentA: eng.connector?.ratedCurrentA,
      provenance: eng.connector
        ? prov
        : { method: "unknown", notes: "Battery connector type unspecified in catalogue preset." },
    },
  ];

  const pins: ElectricalPinSpec[] = [
    {
      pinId: "pin-bat-pos",
      pinName: "BAT+",
      pinNumber: 1,
      pinType: "power",
      role: "power-output",
      direction: "output",
      supportedVoltage: { nominalV, minV, maxV },
      currentLimits: {
        maxContinuousA: maxContinuousDischargeA,
        peakOrStallA: peakDischargeA,
      },
      signalTypes: [],
      isPower: true,
      connectorId,
      provenance: toElectricalProvenance(eng.electrical?.provenance ?? eng.generalProvenance),
    },
    {
      pinId: "pin-bat-neg",
      pinName: "BAT- (GND)",
      pinNumber: 2,
      pinType: "ground",
      role: "ground",
      direction: "reference",
      signalTypes: [],
      isGround: true,
      connectorId,
      provenance: toElectricalProvenance(eng.electrical?.provenance ?? eng.generalProvenance),
    },
  ];

  const interfaces: ElectricalInterfaceSpec[] = [
    {
      interfaceId: "bat-power-out",
      name: "Main DC Power Output (+)",
      role: "power-output",
      voltageSpec: { nominalV, minV, maxV },
      currentSpec: {
        maxContinuousA: maxContinuousDischargeA,
        peakOrStallA: peakDischargeA,
      },
      pinIds: ["pin-bat-pos"],
      connectorId,
      groundReferenceInterfaceId: "bat-gnd",
      provenance: toElectricalProvenance(eng.electrical?.provenance ?? eng.generalProvenance),
    },
    {
      interfaceId: "bat-gnd",
      name: "Battery Negative / Reference (-)",
      role: "ground",
      pinIds: ["pin-bat-neg"],
      connectorId,
      provenance: toElectricalProvenance(eng.electrical?.provenance ?? eng.generalProvenance),
    },
  ];

  return {
    specId: `elec-${part.id}`,
    partId: part.id,
    componentType: "battery",
    model: part.name,
    interfaces,
    pins,
    connectors,
    batterySpec: {
      nominalVoltageV: nominalV,
      maxVoltageV: maxV,
      minOperatingVoltageV: minV,
      capacityMah,
      maxContinuousDischargeA,
      peakDischargeA,
      chemistry: eng.chemistry ?? catItem?.chemistry,
      cellCountS: eng.cellCountS,
      parallelCountP: eng.parallelCountP,
      internalResistanceOhm: eng.electrical?.internalResistanceOhm,
    },
    assumptions:
      unknownFields.length > 0
        ? ["Unspecified discharge ratings, internal resistance, or connector types remain unknown."]
        : [],
    unknownFields,
    provenance: prov,
  };
}

function buildMotorElectricalComponentSpec(part: RobotPart): ElectricalComponentSpec {
  const catItem = part.motorCatalogueId
    ? motorCatalogue.find((m) => m.id === part.motorCatalogueId)
    : undefined;
  const eng = resolveMotorEngineeringSpec(part, catItem);
  const el = eng.electrical;
  const prov = toElectricalProvenance(el?.provenance ?? eng.generalProvenance);

  const unknownFields: string[] = [];
  if (el?.nominalVoltageV === undefined) unknownFields.push("nominalVoltageV");
  if (el?.ratedCurrentA === undefined) unknownFields.push("ratedCurrentA");
  if (el?.stallCurrentA === undefined) unknownFields.push("stallCurrentA");
  if (el?.noLoadCurrentA === undefined) unknownFields.push("noLoadCurrentA");

  const electricalPowerW =
    el?.nominalVoltageV !== undefined && el?.ratedCurrentA !== undefined
      ? Number((el.nominalVoltageV * el.ratedCurrentA).toFixed(2))
      : undefined;

  const pins: ElectricalPinSpec[] = [
    {
      pinId: "pin-motor-a",
      pinName: "Terminal A (M+)",
      pinNumber: 1,
      pinType: "power",
      role: "power-input",
      direction: "input",
      supportedVoltage: el
        ? { nominalV: el.nominalVoltageV, minV: el.minVoltageV, maxV: el.maxVoltageV }
        : undefined,
      currentLimits: el
        ? {
            nominalA: el.ratedCurrentA,
            maxContinuousA: el.ratedCurrentA,
            peakOrStallA: el.stallCurrentA,
          }
        : undefined,
      signalTypes: ["pwm"],
      pwmCapable: true,
      isPower: true,
      connectorId: "conn-motor-leads",
      provenance: prov,
    },
    {
      pinId: "pin-motor-b",
      pinName: "Terminal B (M- / Return)",
      pinNumber: 2,
      pinType: "mixed",
      role: "power-bidirectional",
      direction: "bidirectional",
      supportedVoltage: el
        ? { nominalV: el.nominalVoltageV, minV: el.minVoltageV, maxV: el.maxVoltageV }
        : undefined,
      currentLimits: el
        ? {
            nominalA: el.ratedCurrentA,
            maxContinuousA: el.ratedCurrentA,
            peakOrStallA: el.stallCurrentA,
          }
        : undefined,
      signalTypes: ["pwm"],
      pwmCapable: true,
      isPower: true,
      connectorId: "conn-motor-leads",
      constraints: ["H-bridge / bidirectional reversible DC input terminal pair"],
      provenance: prov,
    },
  ];

  const connectors: ElectricalConnectorSpec[] = [
    {
      connectorId: "conn-motor-leads",
      connectorType: "unknown",
      name: "Motor Power Lead Pair",
      pinCount: 2,
      pinLayout: "2-wire DC drive",
      pinDefinitions: [
        { pinNumber: 1, pinId: "pin-motor-a", label: "M+" },
        { pinNumber: 2, pinId: "pin-motor-b", label: "M-" },
      ],
      provenance: {
        method: "unknown",
        notes: "Motor connector termination unspecified in catalogue preset.",
      },
    },
  ];

  const interfaces: ElectricalInterfaceSpec[] = [
    {
      interfaceId: "motor-drive-input",
      name: "DC Drive Power Input (M+/M-)",
      role: "power-input",
      voltageSpec: el
        ? { nominalV: el.nominalVoltageV, minV: el.minVoltageV, maxV: el.maxVoltageV }
        : undefined,
      currentSpec: el
        ? {
            nominalA: el.ratedCurrentA,
            maxContinuousA: el.ratedCurrentA,
            peakOrStallA: el.stallCurrentA,
          }
        : undefined,
      supportedSignals: ["pwm"],
      pinIds: ["pin-motor-a", "pin-motor-b"],
      connectorId: "conn-motor-leads",
      reversiblePolarity: eng.technology !== "servo",
      provenance: prov,
    },
  ];

  return {
    specId: `elec-${part.id}`,
    partId: part.id,
    componentType: "motor",
    model: part.name,
    interfaces,
    pins,
    connectors,
    motorSpec: {
      nominalVoltageV: el?.nominalVoltageV,
      minVoltageV: el?.minVoltageV,
      maxVoltageV: el?.maxVoltageV,
      ratedCurrentA: el?.ratedCurrentA,
      stallCurrentA: el?.stallCurrentA,
      noLoadCurrentA: el?.noLoadCurrentA,
      electricalPowerW,
      reversiblePolarity: eng.technology !== "servo",
    },
    assumptions:
      unknownFields.length > 0
        ? ["Catalogue motor preset omits verified winding voltage and current curves."]
        : [],
    unknownFields,
    provenance: prov,
  };
}

function buildControllerElectricalComponentSpec(part: RobotPart): ElectricalComponentSpec {
  const catItem = part.controllerCatalogueId
    ? controllerCatalogue.find((c) => c.id === part.controllerCatalogueId)
    : undefined;
  const eng = resolveControllerEngineeringSpec(part, catItem);
  const el = eng.electrical;
  const ifaceMeta = eng.interfaces;
  const prov = toElectricalProvenance(el?.provenance ?? eng.generalProvenance);

  const logicV = el?.logicLevelV;
  const vinRange = el?.inputVoltageRangeV;
  const protocols = (ifaceMeta?.supportedProtocols ?? []) as readonly ElectricalSignalType[];
  const digitalCount = ifaceMeta?.digitalIoPins ?? 0;
  const pwmCount = ifaceMeta?.pwmOutputs ?? 0;
  const analogCount = ifaceMeta?.analogInputs ?? 0;

  const pins: ElectricalPinSpec[] = [
    {
      pinId: "pin-vin",
      pinName: "VIN",
      pinNumber: "VIN",
      pinType: "power",
      role: "power-input",
      direction: "input",
      supportedVoltage: vinRange
        ? {
            nominalV: vinRange.minV,
            minV: vinRange.minV,
            maxV: vinRange.maxV,
          }
        : undefined,
      signalTypes: [],
      isPower: true,
      connectorId: "conn-ctrl-power",
      provenance: prov,
    },
    {
      pinId: "pin-vcc",
      pinName: logicV ? `${logicV}V Logic Rail` : "Logic Rail",
      pinNumber: "VCC",
      pinType: "power",
      role: "power-output",
      direction: "output",
      supportedVoltage: logicV ? { nominalV: logicV, minV: logicV * 0.95, maxV: logicV * 1.05 } : undefined,
      currentLimits: el?.maxLogicRailCurrentA
        ? { maxContinuousA: el.maxLogicRailCurrentA }
        : undefined,
      signalTypes: [],
      isPower: true,
      connectorId: "conn-ctrl-header",
      provenance: prov,
    },
    {
      pinId: "pin-gnd",
      pinName: "GND",
      pinNumber: "GND",
      pinType: "ground",
      role: "ground",
      direction: "reference",
      signalTypes: [],
      isGround: true,
      connectorId: "conn-ctrl-power",
      provenance: prov,
    },
  ];

  // Generate representative pin groups accurately reflecting digital / PWM / analog limits
  // without assuming every GPIO supports every capability.
  const pwmPinCountCapped = Math.min(pwmCount, 4);
  for (let i = 0; i < pwmPinCountCapped; i++) {
    pins.push({
      pinId: `pin-pwm-${i}`,
      pinName: `PWM${i + 1}`,
      pinNumber: `D${i + 3}`,
      pinType: "signal",
      role: "signal-bidirectional",
      direction: "bidirectional",
      supportedVoltage: logicV ? { nominalV: logicV, minV: 0, maxV: logicV } : undefined,
      signalTypes: ["digital", "pwm"],
      digitalCapable: true,
      pwmCapable: true,
      analogCapable: false,
      connectorId: "conn-ctrl-header",
      constraints: logicV ? [`Logic tolerant up to ${logicV}V`] : undefined,
      provenance: prov,
    });
  }

  const analogPinCountCapped = Math.min(analogCount, 2);
  for (let i = 0; i < analogPinCountCapped; i++) {
    pins.push({
      pinId: `pin-adc-${i}`,
      pinName: `ADC${i}`,
      pinNumber: `A${i}`,
      pinType: "signal",
      role: "signal-input",
      direction: "input",
      supportedVoltage: logicV ? { nominalV: logicV, minV: 0, maxV: logicV } : undefined,
      signalTypes: ["analog", "digital"],
      digitalCapable: true,
      analogCapable: true,
      pwmCapable: false,
      connectorId: "conn-ctrl-header",
      constraints: ["Analog ADC input channel (not a high-current output)"],
      provenance: prov,
    });
  }

  if (protocols.length > 0) {
    pins.push({
      pinId: "pin-comm-bus",
      pinName: `Bus (${protocols.slice(0, 3).map((p) => p.toUpperCase()).join("/")})`,
      pinNumber: "BUS",
      pinType: "signal",
      role: "signal-bidirectional",
      direction: "bidirectional",
      supportedVoltage: logicV ? { nominalV: logicV, minV: 0, maxV: logicV } : undefined,
      signalTypes: protocols,
      digitalCapable: true,
      communicationCapabilities: protocols,
      connectorId: "conn-ctrl-header",
      provenance: prov,
    });
  }

  const interfaces: ElectricalInterfaceSpec[] = [
    {
      interfaceId: "ctrl-power-in",
      name: "Controller Power Input (VIN)",
      role: "power-input",
      voltageSpec: vinRange
        ? {
            nominalV: vinRange.minV,
            minV: vinRange.minV,
            maxV: vinRange.maxV,
          }
        : undefined,
      pinIds: ["pin-vin"],
      connectorId: "conn-ctrl-power",
      groundReferenceInterfaceId: "ctrl-gnd",
      provenance: prov,
    },
    {
      interfaceId: "ctrl-logic-vcc",
      name: logicV ? `Regulated ${logicV}V Logic Rail` : "Regulated Logic Rail",
      role: "power-output",
      voltageSpec: logicV
        ? { nominalV: logicV, minV: logicV * 0.95, maxV: logicV * 1.05, logicLevelV: logicV }
        : undefined,
      currentSpec: el?.maxLogicRailCurrentA
        ? { maxContinuousA: el.maxLogicRailCurrentA }
        : undefined,
      pinIds: ["pin-vcc"],
      connectorId: "conn-ctrl-header",
      groundReferenceInterfaceId: "ctrl-gnd",
      provenance: prov,
    },
    {
      interfaceId: "ctrl-gnd",
      name: "Controller Ground (GND)",
      role: "ground",
      pinIds: ["pin-gnd"],
      connectorId: "conn-ctrl-power",
      provenance: prov,
    },
    {
      interfaceId: "ctrl-gpio-signals",
      name: "GPIO / PWM / Bus Signals",
      role: "signal-bidirectional",
      voltageSpec: logicV ? { nominalV: logicV, logicLevelV: logicV, maxV: logicV } : undefined,
      supportedSignals: ["digital", ...(pwmCount > 0 ? ["pwm"] : []), ...(analogCount > 0 ? ["analog"] : []), ...protocols],
      pinIds: pins.filter((p) => p.pinType === "signal").map((p) => p.pinId),
      connectorId: "conn-ctrl-header",
      groundReferenceInterfaceId: "ctrl-gnd",
      provenance: prov,
    },
  ];

  const connectors: ElectricalConnectorSpec[] = [
    {
      connectorId: "conn-ctrl-power",
      connectorType: part.controllerCatalogueId === "esp32-devkit" ? "micro-usb" : "barrel-jack",
      name: "Board Power Supply Input",
      pinCount: 2,
      pinDefinitions: [
        { pinNumber: 1, pinId: "pin-vin", label: "VIN" },
        { pinNumber: 2, pinId: "pin-gnd", label: "GND" },
      ],
      provenance: prov,
    },
    {
      connectorId: "conn-ctrl-header",
      connectorType: "pin-header",
      name: "Standard GPIO Header",
      pinCount: Math.max(2, pins.length - 2),
      pinDefinitions: pins
        .filter((p) => p.connectorId === "conn-ctrl-header")
        .map((p) => ({
          pinNumber: p.pinNumber ?? p.pinId,
          pinId: p.pinId,
          label: p.pinName,
        })),
      provenance: prov,
    },
  ];

  const unknownFields: string[] = [];
  if (el?.idleCurrentA === undefined) unknownFields.push("idleCurrentA");
  if (!vinRange) unknownFields.push("inputVoltageRangeV");
  if (!logicV) unknownFields.push("logicLevelV");

  return {
    specId: `elec-${part.id}`,
    partId: part.id,
    componentType: "controller",
    model: part.name,
    interfaces,
    pins,
    connectors,
    controllerSpec: {
      boardArchitecture: eng.processorArchitecture ?? catItem?.processor,
      logicLevelV: logicV,
      inputVoltageRangeV: vinRange,
      idleCurrentA: el?.idleCurrentA,
      maxLogicRailCurrentA: el?.maxLogicRailCurrentA,
      gpioCount: digitalCount || undefined,
      digitalPinCount: digitalCount || undefined,
      analogPinCount: analogCount || undefined,
      pwmPinCount: pwmCount || undefined,
      communicationProtocols: protocols,
    },
    assumptions: [
      "Representative pin subset modeled from controller interface capabilities; individual MCU datasheet multiplexing rules are simplified.",
    ],
    unknownFields,
    provenance: prov,
  };
}

/**
 * Resolves a structured `ElectricalComponentSpec` from any RobotPart.
 * Explicit `part.electricalSpec` overrides take precedence; otherwise adapts Battery,
 * Motor, and Controller parts cleanly from canonical engineering specs without fabricating data.
 */
export function resolvePartElectricalSpec(
  part: RobotPart
): ElectricalComponentSpec | null {
  if (part.electricalSpec) {
    return part.electricalSpec;
  }

  if (part.electricalCatalogueId) {
    const item = getElectricalCatalogueItem(part.electricalCatalogueId);
    if (item) {
      return {
        specId: `elec-${part.id}`,
        partId: part.id,
        ...item.electricalSpecTemplate,
      };
    }
  }

  switch (part.type) {
    case "Battery":
      return buildBatteryElectricalComponentSpec(part);
    case "Motor":
      return buildMotorElectricalComponentSpec(part);
    case "Controller":
      return buildControllerElectricalComponentSpec(part);
    default:
      return null;
  }
}
