import { useMemo, useState } from "react";
import { resolvePartElectricalSpec } from "../../features/electrical/logic/electricalComponentAdapters";
import type { ElectricalConnection } from "../../features/electrical/types/electrical.types";
import type { RobotPart } from "../../features/robot-builder/types/robot.types";
import { useRobotStore } from "../../store/robotStore";

interface ElectricalInspectorSectionProps {
  readonly part: RobotPart;
  readonly parts: readonly RobotPart[];
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly onRemoveElectricalConnection?: (connectionId: string) => void;
  readonly onToggleSwitch?: (partId: string, switchClosed: boolean) => void;
}

export default function ElectricalInspectorSection({
  part,
  parts,
  electricalConnections,
  onRemoveElectricalConnection,
  onToggleSwitch,
}: ElectricalInspectorSectionProps) {
  const [showPinDetails, setShowPinDetails] = useState(false);
  const spec = useMemo(() => resolvePartElectricalSpec(part), [part]);
  const setElectricalSwitchState = useRobotStore(
    (state) => state.setElectricalSwitchState
  );

  const relatedConnections = useMemo(
    () =>
      electricalConnections.filter(
        (c) => c.sourcePartId === part.id || c.targetPartId === part.id
      ),
    [electricalConnections, part.id]
  );

  if (!spec) return null;

  const partById = new Map(parts.map((p) => [p.id, p]));
  const isSwitch =
    spec.componentType === "switch" ||
    spec.driverOrRegulatorSpec?.powerRole === "switch";
  const isSwitchClosed = part.electricalState?.switchClosed !== false;
  const isFuse =
    spec.driverOrRegulatorSpec?.powerRole === "fuse" ||
    spec.interfaces.some((i) => i.interfaceId.includes("fuse"));
  const fuseRatingA =
    spec.driverOrRegulatorSpec?.continuousCurrentPerChannelA ??
    spec.interfaces.find((i) => i.currentSpec?.maxContinuousA !== undefined)
      ?.currentSpec?.maxContinuousA;

  return (
    <div className="workshop-mount-target">
      <div className="section-label">ELECTRICAL SPECIFICATIONS</div>
      <div className="property-row">
        <span>Component Role</span>
        <span>{spec.componentType}</span>
      </div>
      <div className="property-row">
        <span>Provenance</span>
        <span>{spec.provenance.method}</span>
      </div>

      {spec.batterySpec && (
        <>
          <div className="property-row">
            <span>Voltage (Nom / Max / Min)</span>
            <span>
              {spec.batterySpec.nominalVoltageV ?? "?"}V / {spec.batterySpec.maxVoltageV ?? "?"}V /{" "}
              {spec.batterySpec.minOperatingVoltageV ?? "?"}V
            </span>
          </div>
          <div className="property-row">
            <span>Max Discharge</span>
            <span>
              {spec.batterySpec.maxContinuousDischargeA !== undefined
                ? `${spec.batterySpec.maxContinuousDischargeA.toFixed(1)} A`
                : "Unknown"}
            </span>
          </div>
        </>
      )}

      {spec.motorSpec && (
        <div className="property-row">
          <span>Rated / Stall Current</span>
          <span>
            {spec.motorSpec.ratedCurrentA !== undefined
              ? `${spec.motorSpec.ratedCurrentA}A`
              : "Unknown"}{" "}
            /{" "}
            {spec.motorSpec.stallCurrentA !== undefined
              ? `${spec.motorSpec.stallCurrentA}A`
              : "Unknown"}
          </span>
        </div>
      )}

      {spec.controllerSpec && (
        <>
          <div className="property-row">
            <span>Logic / VIN Range</span>
            <span>
              {spec.controllerSpec.logicLevelV ?? "?"}V ·{" "}
              {spec.controllerSpec.inputVoltageRangeV
                ? `${spec.controllerSpec.inputVoltageRangeV.minV}–${spec.controllerSpec.inputVoltageRangeV.maxV}V`
                : "Unknown"}
            </span>
          </div>
          <div className="property-row">
            <span>GPIO / PWM / ADC</span>
            <span>
              {spec.controllerSpec.digitalPinCount ?? 0} /{" "}
              {spec.controllerSpec.pwmPinCount ?? 0} /{" "}
              {spec.controllerSpec.analogPinCount ?? 0}
            </span>
          </div>
        </>
      )}

      {isSwitch && (
        <div className="property-row" style={{ alignItems: "center", marginTop: 4 }}>
          <span>Switch State</span>
          <button
            type="button"
            className="sim-clear-selection-btn"
            onClick={() =>
              (onToggleSwitch ?? setElectricalSwitchState)(part.id, !isSwitchClosed)
            }
          >
            {isSwitchClosed ? "CLOSED (Open Switch)" : "OPEN (Close Switch)"}
          </button>
        </div>
      )}

      {isFuse && (
        <div className="property-row" style={{ marginTop: 4 }}>
          <span>Fuse Rating</span>
          <span>
            {fuseRatingA !== undefined ? `${fuseRatingA} A` : "Unknown"}
            {part.electricalState?.fuseTripped ? " · TRIPPED" : " · INTACT"}
          </span>
        </div>
      )}

      <div className="section-label" style={{ marginTop: 8 }}>
        ELECTRICAL INTERFACES ({spec.interfaces.length}) · PINS ({spec.pins.length})
      </div>
      <div className="workshop-compat-checks">
        {spec.interfaces.map((iface) => (
          <div key={iface.interfaceId} className="workshop-compat-check-row pass">
            <strong>
              {iface.name} ({iface.role})
            </strong>
            <small className="workshop-compat-hint">
              Pins: {iface.pinIds.length}
              {iface.voltageSpec?.nominalV !== undefined
                ? ` · ${iface.voltageSpec.nominalV}V`
                : ""}
              {iface.supportedSignals?.length
                ? ` · ${iface.supportedSignals.slice(0, 4).join(", ")}`
                : ""}
            </small>
          </div>
        ))}
      </div>

      {spec.connectors.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 8 }}>
            CONNECTORS ({spec.connectors.length})
          </div>
          <div className="workshop-compat-checks">
            {spec.connectors.map((connector) => (
              <div
                key={connector.connectorId}
                className="workshop-compat-check-row pass"
              >
                <strong>{connector.name}</strong>
                <small className="workshop-compat-hint">
                  {connector.connectorType} · {connector.pinCount} pin
                  {connector.pinCount === 1 ? "" : "s"}
                  {connector.gender && connector.gender !== "unspecified"
                    ? ` · ${connector.gender}`
                    : ""}
                </small>
              </div>
            ))}
          </div>
        </>
      )}

      {spec.pins.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            className="sim-clear-selection-btn"
            onClick={() => setShowPinDetails((prev) => !prev)}
          >
            {showPinDetails
              ? "Hide Pin Details"
              : `Show Pin Details (${spec.pins.length})`}
          </button>
          {showPinDetails && (
            <div className="workshop-compat-checks" style={{ marginTop: 6 }}>
              {spec.pins.map((pin) => {
                const capFlags = [
                  ...(pin.signalTypes ?? []),
                  pin.pwmCapable ? "pwm" : null,
                  pin.analogCapable ? "analog" : null,
                  pin.digitalCapable ? "digital" : null,
                ].filter((v): v is string => Boolean(v));
                const uniqueCaps = Array.from(new Set(capFlags));
                return (
                  <div
                    key={pin.pinId}
                    className="workshop-compat-check-row pass"
                  >
                    <strong>
                      {pin.pinNumber !== undefined ? `#${pin.pinNumber} ` : ""}
                      {pin.pinName} ({pin.role})
                    </strong>
                    <small className="workshop-compat-hint">
                      {uniqueCaps.length > 0
                        ? uniqueCaps.slice(0, 5).join(", ")
                        : pin.pinType}
                      {pin.supportedVoltage?.nominalV !== undefined
                        ? ` · ${pin.supportedVoltage.nominalV}V`
                        : ""}
                      {pin.constraints?.length
                        ? ` · ${pin.constraints[0]}`
                        : ""}
                    </small>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {spec.unknownFields.length > 0 && (
        <small className="builder-intro" style={{ display: "block", marginTop: 4 }}>
          Unknown electrical fields: {spec.unknownFields.join(", ")}
        </small>
      )}

      {relatedConnections.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 8 }}>
            LOGICAL CONNECTIONS ({relatedConnections.length})
          </div>
          {relatedConnections.map((conn) => {
            const peerId =
              conn.sourcePartId === part.id ? conn.targetPartId : conn.sourcePartId;
            const peerName = partById.get(peerId)?.name ?? peerId;
            return (
              <div className="installed-motor" key={conn.id}>
                <span>
                  {conn.connectionType}: {peerName}
                </span>
                {onRemoveElectricalConnection && (
                  <button
                    type="button"
                    className="sim-clear-selection-btn"
                    onClick={() => onRemoveElectricalConnection(conn.id)}
                  >
                    Unwire
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
