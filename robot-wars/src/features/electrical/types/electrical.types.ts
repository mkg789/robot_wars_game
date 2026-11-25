import type { ProvenanceMeta } from "../../robot-builder/types/engineering.types";

/**
 * Extended provenance classification supporting explicit electrical acquisition methods.
 * Distinguishes datasheet, manufacturer, user-supplied, measured, estimated, and unknown data.
 */
export type ElectricalProvenanceMethod =
  | "datasheet"
  | "manufacturer"
  | "user-supplied"
  | "measured"
  | "estimated"
  | "unknown";

export type ElectricalProvenance =
  | {
      readonly method: "datasheet" | "manufacturer" | "measured";
      readonly verified: boolean;
      readonly source: string;
      readonly notes?: string;
    }
  | {
      readonly method: "user-supplied";
      readonly source?: string;
      readonly notes?: string;
    }
  | {
      readonly method: "estimated";
      readonly basis: string;
      readonly notes?: string;
    }
  | {
      readonly method: "unknown";
      readonly notes?: string;
    };

export function toElectricalProvenance(
  meta: ProvenanceMeta | undefined
): ElectricalProvenance {
  if (!meta) {
    return {
      method: "unknown",
      notes: "No electrical provenance metadata supplied.",
    };
  }
  return meta;
}

export type BuiltInElectricalSignalType =
  | "digital"
  | "analog"
  | "pwm"
  | "uart"
  | "i2c"
  | "spi"
  | "can"
  | "ppm"
  | "sbus"
  | "usb";

/**
 * Extensible signal / communication classification so future bus standards
 * can integrate without modifying core electrical unions.
 */
export type ElectricalSignalType = BuiltInElectricalSignalType | (string & {});

export type ElectricalInterfaceRole =
  | "power-input"
  | "power-output"
  | "power-bidirectional"
  | "signal-input"
  | "signal-output"
  | "signal-bidirectional"
  | "ground"
  | "passive";

export type ElectricalDirection =
  | "input"
  | "output"
  | "bidirectional"
  | "reference"
  | "passive";

export type ElectricalPinCategory =
  | "power"
  | "ground"
  | "signal"
  | "passive"
  | "mixed";

export interface ElectricalVoltageRange {
  readonly nominalV?: number;
  readonly minV?: number;
  readonly maxV?: number;
  readonly logicLevelV?: number;
}

export interface ElectricalCurrentLimits {
  readonly nominalA?: number;
  readonly maxContinuousA?: number;
  readonly peakOrStallA?: number;
}

export interface ElectricalPinSpec {
  readonly pinId: string;
  readonly pinName: string;
  readonly pinNumber?: number | string;
  readonly pinType: ElectricalPinCategory;
  readonly role: ElectricalInterfaceRole;
  readonly direction: ElectricalDirection;
  readonly supportedVoltage?: ElectricalVoltageRange;
  readonly currentLimits?: ElectricalCurrentLimits;
  readonly signalTypes: readonly ElectricalSignalType[];
  readonly digitalCapable?: boolean;
  readonly analogCapable?: boolean;
  readonly pwmCapable?: boolean;
  readonly communicationCapabilities?: readonly ElectricalSignalType[];
  readonly isGround?: boolean;
  readonly isPower?: boolean;
  readonly connectorId?: string;
  readonly constraints?: readonly string[];
  readonly provenance: ElectricalProvenance;
}

export type ElectricalConnectorCategory =
  | "xt30"
  | "xt60"
  | "xt90"
  | "deans-t"
  | "ec3"
  | "ec5"
  | "jst-xh"
  | "jst-rcy"
  | "dupont-header"
  | "pin-header"
  | "screw-terminal"
  | "barrel-jack"
  | "usb-type-b"
  | "micro-usb"
  | "molex"
  | "direct-solder"
  | "custom"
  | "unknown";

export interface ConnectorPinDefinition {
  readonly pinNumber: number | string;
  readonly pinId: string;
  readonly label?: string;
}

export interface ElectricalConnectorSpec {
  readonly connectorId: string;
  readonly connectorType: ElectricalConnectorCategory;
  readonly name: string;
  readonly gender?: "male" | "female" | "plug" | "receptacle" | "unspecified";
  readonly pinCount: number;
  readonly pinLayout?: string;
  readonly pinDefinitions: readonly ConnectorPinDefinition[];
  readonly orientation?: string;
  readonly compatibleConnectorTypes?: readonly ElectricalConnectorCategory[];
  readonly ratedCurrentA?: number;
  readonly ratedVoltageV?: number;
  readonly provenance: ElectricalProvenance;
}

export interface ElectricalInterfaceSpec {
  readonly interfaceId: string;
  readonly name: string;
  readonly role: ElectricalInterfaceRole;
  readonly voltageSpec?: ElectricalVoltageRange;
  readonly currentSpec?: ElectricalCurrentLimits;
  readonly supportedSignals?: readonly ElectricalSignalType[];
  readonly pinIds: readonly string[];
  readonly connectorId?: string;
  readonly groundReferenceInterfaceId?: string;
  readonly reversiblePolarity?: boolean;
  readonly constraints?: readonly string[];
  readonly provenance: ElectricalProvenance;
}

export type ElectricalComponentKind =
  | "battery"
  | "motor"
  | "controller"
  | "motor-driver"
  | "sensor"
  | "servo"
  | "actuator"
  | "voltage-regulator"
  | "pdb"
  | "relay"
  | "switch"
  | "passive"
  | "other";

export interface BatteryElectricalDomainSpec {
  readonly nominalVoltageV?: number;
  readonly maxVoltageV?: number;
  readonly minOperatingVoltageV?: number;
  readonly capacityMah?: number;
  readonly maxContinuousDischargeA?: number;
  readonly peakDischargeA?: number;
  readonly chemistry?: string;
  readonly cellCountS?: number;
  readonly parallelCountP?: number;
  readonly internalResistanceOhm?: number;
}

export interface MotorElectricalDomainSpec {
  readonly nominalVoltageV?: number;
  readonly minVoltageV?: number;
  readonly maxVoltageV?: number;
  readonly ratedCurrentA?: number;
  readonly stallCurrentA?: number;
  readonly noLoadCurrentA?: number;
  readonly electricalPowerW?: number;
  readonly reversiblePolarity?: boolean;
}

export interface ControllerElectricalDomainSpec {
  readonly boardArchitecture?: string;
  readonly logicLevelV?: number;
  readonly inputVoltageRangeV?: { readonly minV: number; readonly maxV: number };
  readonly idleCurrentA?: number;
  readonly maxLogicRailCurrentA?: number;
  readonly gpioCount?: number;
  readonly digitalPinCount?: number;
  readonly analogPinCount?: number;
  readonly pwmPinCount?: number;
  readonly communicationProtocols?: readonly ElectricalSignalType[];
}

export interface PowerDistributionOrDriverDomainSpec {
  readonly inputVoltageRangeV?: { readonly minV: number; readonly maxV: number };
  readonly outputVoltageRangeV?: { readonly minV: number; readonly maxV: number };
  readonly continuousCurrentPerChannelA?: number;
  readonly peakCurrentA?: number;
  readonly channelCount?: number;
  readonly logicControlVoltageV?: number;
}

export interface ElectricalComponentSpec {
  readonly specId: string;
  readonly partId?: string;
  readonly componentType: ElectricalComponentKind;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly interfaces: readonly ElectricalInterfaceSpec[];
  readonly pins: readonly ElectricalPinSpec[];
  readonly connectors: readonly ElectricalConnectorSpec[];
  readonly batterySpec?: BatteryElectricalDomainSpec;
  readonly motorSpec?: MotorElectricalDomainSpec;
  readonly controllerSpec?: ControllerElectricalDomainSpec;
  readonly driverOrRegulatorSpec?: PowerDistributionOrDriverDomainSpec;
  readonly operatingConstraints?: readonly string[];
  readonly compatibilityConstraints?: readonly string[];
  readonly assumptions: readonly string[];
  readonly unknownFields: readonly string[];
  readonly provenance: ElectricalProvenance;
}

export type ElectricalConnectionKind =
  | "power"
  | "ground"
  | "signal"
  | "pwm"
  | "bus"
  | "passive"
  | "unspecified";

export type ElectricalCompatibilityStatus =
  | "compatible"
  | "compatible-with-warnings"
  | "incompatible"
  | "unknown";

export interface ElectricalWireMetadata {
  readonly wireGaugeAwg?: number;
  readonly color?: string;
  readonly maxCurrentA?: number;
  readonly lengthEstimateM?: number;
  readonly shielded?: boolean;
}

export interface ElectricalConnection {
  readonly id: string;
  readonly sourcePartId: string;
  readonly sourceInterfaceId: string;
  readonly sourcePinId?: string;
  readonly targetPartId: string;
  readonly targetInterfaceId: string;
  readonly targetPinId?: string;
  readonly connectionType: ElectricalConnectionKind;
  readonly signalProtocol?: ElectricalSignalType;
  readonly wireMetadata?: ElectricalWireMetadata;
  readonly notes?: string;
  readonly provenance: ElectricalProvenance;
  readonly validationStatus?: ElectricalCompatibilityStatus;
}

export interface ElectricalCompatibilityCheck {
  readonly id: string;
  readonly aspect:
    | "interface-role"
    | "voltage"
    | "current"
    | "signal-direction"
    | "signal-protocol"
    | "pin-capability"
    | "ground-reference"
    | "connector-physical";
  readonly status: "pass" | "warning" | "error" | "unknown";
  readonly message: string;
  readonly correctiveAction?: string;
  readonly provenance?: ElectricalProvenance;
}

export interface ElectricalCompatibilityResult {
  readonly status: ElectricalCompatibilityStatus;
  readonly reason: string;
  readonly checks: readonly ElectricalCompatibilityCheck[];
  readonly conditionsEvaluated: readonly string[];
  readonly warnings: readonly string[];
  readonly assumptions: readonly string[];
  readonly missingInformation: readonly string[];
  readonly correctiveAction?: string;
  readonly provenance: ElectricalProvenance;
}

export type ElectricalDiagnosticSeverity = "error" | "warning" | "info" | "unknown";

export type ElectricalDiagnosticCode =
  | "missing-component"
  | "missing-interface"
  | "missing-pin"
  | "duplicate-connection"
  | "self-connection"
  | "incompatible-interfaces"
  | "invalid-signal-direction"
  | "voltage-mismatch"
  | "current-limit-exceeded"
  | "signal-protocol-mismatch"
  | "connector-mismatch"
  | "multi-driver-conflict"
  | "missing-electrical-spec"
  | "missing-ground-reference";

export interface ElectricalDiagnostic {
  readonly id: string;
  readonly severity: ElectricalDiagnosticSeverity;
  readonly code: ElectricalDiagnosticCode;
  readonly title: string;
  readonly reason: string;
  readonly partId?: string;
  readonly relatedPartId?: string;
  readonly connectionId?: string;
  readonly conditionEvaluated: string;
  readonly correctiveAction?: string;
  readonly provenance: ElectricalProvenance;
}

export interface ElectricalValidationReport {
  readonly isValid: boolean;
  readonly healthStatus: "healthy" | "warning" | "error" | "unknown";
  readonly diagnostics: readonly ElectricalDiagnostic[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly unknownCount: number;
  readonly connectionResults: Readonly<Record<string, ElectricalCompatibilityResult>>;
}
