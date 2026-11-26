import { useMemo, useState } from "react";
import { evaluateElectricalCompatibility } from "../../features/electrical/logic/electricalCompatibility";
import { resolvePartElectricalSpec } from "../../features/electrical/logic/electricalComponentAdapters";
import type {
  ElectricalCompatibilityResult,
  ElectricalComponentSpec,
  ElectricalConnection,
  ElectricalConnectionKind,
  ElectricalConnectorCategory,
  ElectricalConnectorSpec,
  ElectricalSignalType,
} from "../../features/electrical/types/electrical.types";
import type { RobotPart } from "../../features/robot-builder/types/robot.types";

export interface WiringDraftState {
  sourcePartId: string;
  sourceInterfaceId: string;
  sourcePinId: string;
  targetPartId: string;
  targetInterfaceId: string;
  targetPinId: string;
  connectionType: ElectricalConnectionKind;
  signalProtocol: string;
  wireGaugeAwg: string;
  wireColor: string;
  notes: string;
}

interface ElectricalWiringPanelProps {
  readonly parts: readonly RobotPart[];
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly connectionResults: Readonly<Record<string, ElectricalCompatibilityResult>>;
  readonly selectedConnectionId: string | null;
  readonly draft: WiringDraftState;
  readonly onDraftChange: (patch: Partial<WiringDraftState>) => void;
  readonly onCreateConnection: (
    conn: Omit<ElectricalConnection, "id">
  ) => string | null;
  readonly onUpdateConnection: (
    connectionId: string,
    patch: Partial<ElectricalConnection>
  ) => void;
  readonly onAssignPin: (
    connectionId: string,
    endpoint: "source" | "target",
    pinId: string | undefined
  ) => void;
  readonly onAssignConnector: (
    partId: string,
    interfaceId: string,
    connector: ElectricalConnectorSpec
  ) => void;
  readonly onRemoveConnection: (connectionId: string) => void;
  readonly onSelectConnection: (connectionId: string | null) => void;
  readonly onSelectPart: (partId: string) => void;
}

const CONNECTION_KINDS: readonly ElectricalConnectionKind[] = [
  "power",
  "ground",
  "pwm",
  "signal",
  "bus",
  "passive",
];

const CONNECTOR_CHOICES: readonly ElectricalConnectorCategory[] = [
  "xt60",
  "xt30",
  "jst-xh",
  "jst-rcy",
  "dupont-header",
  "pin-header",
  "screw-terminal",
  "barrel-jack",
  "direct-solder",
];

const PROTOCOL_CHOICES: readonly ElectricalSignalType[] = [
  "digital",
  "pwm",
  "analog",
  "i2c",
  "spi",
  "uart",
  "can",
  "ppm",
];

function suggestConnectionKind(
  srcSpec: ElectricalComponentSpec | null,
  srcIfaceId: string,
  dstSpec: ElectricalComponentSpec | null,
  dstIfaceId: string
): ElectricalConnectionKind {
  const srcIface = srcSpec?.interfaces.find((i) => i.interfaceId === srcIfaceId);
  const dstIface = dstSpec?.interfaces.find((i) => i.interfaceId === dstIfaceId);
  if (srcIface?.role === "ground" || dstIface?.role === "ground") return "ground";
  if (
    srcIface?.role.startsWith("power") ||
    dstIface?.role.startsWith("power")
  ) {
    return "power";
  }
  const sigs = srcIface?.supportedSignals ?? dstIface?.supportedSignals ?? [];
  if (sigs.includes("i2c") || sigs.includes("spi") || sigs.includes("can") || sigs.includes("uart")) {
    return "bus";
  }
  if (sigs.includes("pwm")) return "pwm";
  return "signal";
}

export default function ElectricalWiringPanel({
  parts,
  electricalConnections,
  connectionResults,
  selectedConnectionId,
  draft,
  onDraftChange,
  onCreateConnection,
  onUpdateConnection,
  onAssignPin,
  onAssignConnector,
  onRemoveConnection,
  onSelectConnection,
  onSelectPart,
}: ElectricalWiringPanelProps) {
  const [connSearch, setConnSearch] = useState("");
  const [connFilter, setConnFilter] = useState<
    "all" | "power" | "ground" | "signal" | "issues"
  >("all");
  const [connectorPickerTarget, setConnectorPickerTarget] = useState<
    ElectricalConnectorCategory
  >("dupont-header");

  const electricalEntries = useMemo(
    () =>
      parts
        .map((part) => ({ part, spec: resolvePartElectricalSpec(part) }))
        .filter(
          (entry): entry is { part: RobotPart; spec: ElectricalComponentSpec } =>
            Boolean(entry.spec)
        ),
    [parts]
  );

  const specByPartId = useMemo(
    () => new Map(electricalEntries.map((e) => [e.part.id, e.spec])),
    [electricalEntries]
  );
  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  // Count how many times each pin is used across existing connections
  const pinUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of electricalConnections) {
      if (c.sourcePinId) {
        const k = `${c.sourcePartId}:${c.sourcePinId}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      if (c.targetPinId) {
        const k = `${c.targetPartId}:${c.targetPinId}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    return counts;
  }, [electricalConnections]);

  const srcSpec = specByPartId.get(draft.sourcePartId) ?? null;
  const dstSpec = specByPartId.get(draft.targetPartId) ?? null;
  const srcIface = srcSpec?.interfaces.find(
    (i) => i.interfaceId === draft.sourceInterfaceId
  );
  const dstIface = dstSpec?.interfaces.find(
    (i) => i.interfaceId === draft.targetInterfaceId
  );
  const srcPin = srcSpec?.pins.find((p) => p.pinId === draft.sourcePinId);
  const dstPin = dstSpec?.pins.find((p) => p.pinId === draft.targetPinId);

  const srcConnSpec = srcIface?.connectorId
    ? srcSpec?.connectors.find((c) => c.connectorId === srcIface.connectorId)
    : undefined;
  const dstConnSpec = dstIface?.connectorId
    ? dstSpec?.connectors.find((c) => c.connectorId === dstIface.connectorId)
    : undefined;

  const liveCompatibility = useMemo(() => {
    if (!srcSpec || !srcIface || !dstSpec || !dstIface) return null;
    return evaluateElectricalCompatibility({
      sourceComponent: srcSpec,
      sourceInterface: srcIface,
      sourcePin: srcPin,
      sourceConnector: srcConnSpec,
      targetComponent: dstSpec,
      targetInterface: dstIface,
      targetPin: dstPin,
      targetConnector: dstConnSpec,
      signalProtocol: draft.signalProtocol
        ? (draft.signalProtocol as ElectricalSignalType)
        : undefined,
    });
  }, [srcSpec, srcIface, dstSpec, dstIface, srcPin, dstPin, srcConnSpec, dstConnSpec, draft.signalProtocol]);

  const filteredConnections = useMemo(() => {
    const q = connSearch.trim().toLowerCase();
    return electricalConnections.filter((conn) => {
      const compat = connectionResults[conn.id];
      if (connFilter === "power" && conn.connectionType !== "power") return false;
      if (connFilter === "ground" && conn.connectionType !== "ground") return false;
      if (
        connFilter === "signal" &&
        conn.connectionType !== "signal" &&
        conn.connectionType !== "pwm" &&
        conn.connectionType !== "bus"
      ) {
        return false;
      }
      if (
        connFilter === "issues" &&
        compat?.status !== "incompatible" &&
        compat?.status !== "compatible-with-warnings"
      ) {
        return false;
      }
      if (!q) return true;
      const srcName = partById.get(conn.sourcePartId)?.name ?? conn.sourcePartId;
      const dstName = partById.get(conn.targetPartId)?.name ?? conn.targetPartId;
      return (
        srcName.toLowerCase().includes(q) ||
        dstName.toLowerCase().includes(q) ||
        conn.connectionType.toLowerCase().includes(q) ||
        (conn.notes ?? "").toLowerCase().includes(q) ||
        (conn.signalProtocol ?? "").toLowerCase().includes(q)
      );
    });
  }, [electricalConnections, connectionResults, connFilter, connSearch, partById]);

  const selectedConn = electricalConnections.find(
    (c) => c.id === selectedConnectionId
  );

  const handleCreate = () => {
    if (!srcSpec || !srcIface || !dstSpec || !dstIface) return;
    const gaugeNum = Number(draft.wireGaugeAwg);
    const createdId = onCreateConnection({
      sourcePartId: draft.sourcePartId,
      sourceInterfaceId: draft.sourceInterfaceId,
      sourcePinId: draft.sourcePinId || undefined,
      targetPartId: draft.targetPartId,
      targetInterfaceId: draft.targetInterfaceId,
      targetPinId: draft.targetPinId || undefined,
      connectionType: draft.connectionType,
      signalProtocol: draft.signalProtocol
        ? (draft.signalProtocol as ElectricalSignalType)
        : undefined,
      wireMetadata:
        draft.wireGaugeAwg || draft.wireColor
          ? {
              wireGaugeAwg:
                Number.isFinite(gaugeNum) && gaugeNum > 0 ? gaugeNum : undefined,
              color: draft.wireColor || undefined,
            }
          : undefined,
      notes: draft.notes.trim() || undefined,
      provenance: {
        method: "user-supplied",
        notes: "Created in Electrical Wiring Workspace",
      },
      validationStatus: liveCompatibility?.status,
    });
    if (createdId) {
      onSelectConnection(createdId);
      onDraftChange({ notes: "" });
    }
  };

  return (
    <div className="electrical-wiring-panel">
      {/* Guided Interactive Wiring Builder */}
      <div className="section-label">CREATE ELECTRICAL CONNECTION</div>

      {electricalEntries.length < 2 ? (
        <p className="builder-intro">
          Install at least two electrical components to wire connections between endpoints.
        </p>
      ) : (
        <div className="electrical-builder-form">
          <div className="electrical-endpoint-group">
            <small className="electrical-step-label">1. SOURCE ENDPOINT</small>
            <select
              aria-label="Source component"
              value={draft.sourcePartId}
              onChange={(e) => {
                const nextPartId = e.target.value;
                const nextSpec = specByPartId.get(nextPartId) ?? null;
                const nextIface = nextSpec?.interfaces[0];
                const nextPinId = nextIface?.pinIds[0] ?? "";
                const suggested = suggestConnectionKind(
                  nextSpec,
                  nextIface?.interfaceId ?? "",
                  dstSpec,
                  draft.targetInterfaceId
                );
                onDraftChange({
                  sourcePartId: nextPartId,
                  sourceInterfaceId: nextIface?.interfaceId ?? "",
                  sourcePinId: nextPinId,
                  connectionType: suggested,
                });
              }}
            >
              <option value="">Select source component</option>
              {electricalEntries.map(({ part }) => (
                <option key={part.id} value={part.id}>
                  {part.name}
                </option>
              ))}
            </select>

            {srcSpec && (
              <select
                aria-label="Source interface"
                value={draft.sourceInterfaceId}
                onChange={(e) => {
                  const nextIfaceId = e.target.value;
                  const iface = srcSpec.interfaces.find(
                    (i) => i.interfaceId === nextIfaceId
                  );
                  const suggested = suggestConnectionKind(
                    srcSpec,
                    nextIfaceId,
                    dstSpec,
                    draft.targetInterfaceId
                  );
                  onDraftChange({
                    sourceInterfaceId: nextIfaceId,
                    sourcePinId: iface?.pinIds[0] ?? "",
                    connectionType: suggested,
                  });
                }}
              >
                <option value="">Select source interface</option>
                {srcSpec.interfaces.map((iface) => (
                  <option key={iface.interfaceId} value={iface.interfaceId}>
                    {iface.name} ({iface.role})
                  </option>
                ))}
              </select>
            )}

            {srcIface && srcIface.pinIds.length > 0 && (
              <select
                aria-label="Source pin"
                value={draft.sourcePinId}
                onChange={(e) => onDraftChange({ sourcePinId: e.target.value })}
              >
                <option value="">Interface default (any pin)</option>
                {srcIface.pinIds.map((pid) => {
                  const p = srcSpec?.pins.find((pin) => pin.pinId === pid);
                  const count = pinUsageCounts.get(`${draft.sourcePartId}:${pid}`) ?? 0;
                  return (
                    <option key={pid} value={pid}>
                      {p?.pinName ?? pid} {count === 0 ? "[Free]" : `[Wired ×${count}]`}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          <div className="electrical-endpoint-group">
            <small className="electrical-step-label">2. DESTINATION ENDPOINT</small>
            <select
              aria-label="Target component"
              value={draft.targetPartId}
              onChange={(e) => {
                const nextPartId = e.target.value;
                const nextSpec = specByPartId.get(nextPartId) ?? null;
                const nextIface = nextSpec?.interfaces[0];
                const nextPinId = nextIface?.pinIds[0] ?? "";
                const suggested = suggestConnectionKind(
                  srcSpec,
                  draft.sourceInterfaceId,
                  nextSpec,
                  nextIface?.interfaceId ?? ""
                );
                onDraftChange({
                  targetPartId: nextPartId,
                  targetInterfaceId: nextIface?.interfaceId ?? "",
                  targetPinId: nextPinId,
                  connectionType: suggested,
                });
              }}
            >
              <option value="">Select destination component</option>
              {electricalEntries.map(({ part }) => (
                <option key={part.id} value={part.id}>
                  {part.name}
                </option>
              ))}
            </select>

            {dstSpec && (
              <select
                aria-label="Target interface"
                value={draft.targetInterfaceId}
                onChange={(e) => {
                  const nextIfaceId = e.target.value;
                  const iface = dstSpec.interfaces.find(
                    (i) => i.interfaceId === nextIfaceId
                  );
                  const suggested = suggestConnectionKind(
                    srcSpec,
                    draft.sourceInterfaceId,
                    dstSpec,
                    nextIfaceId
                  );
                  onDraftChange({
                    targetInterfaceId: nextIfaceId,
                    targetPinId: iface?.pinIds[0] ?? "",
                    connectionType: suggested,
                  });
                }}
              >
                <option value="">Select destination interface</option>
                {dstSpec.interfaces.map((iface) => (
                  <option key={iface.interfaceId} value={iface.interfaceId}>
                    {iface.name} ({iface.role})
                  </option>
                ))}
              </select>
            )}

            {dstIface && dstIface.pinIds.length > 0 && (
              <select
                aria-label="Target pin"
                value={draft.targetPinId}
                onChange={(e) => onDraftChange({ targetPinId: e.target.value })}
              >
                <option value="">Interface default (any pin)</option>
                {dstIface.pinIds.map((pid) => {
                  const p = dstSpec?.pins.find((pin) => pin.pinId === pid);
                  const count = pinUsageCounts.get(`${draft.targetPartId}:${pid}`) ?? 0;
                  return (
                    <option key={pid} value={pid}>
                      {p?.pinName ?? pid} {count === 0 ? "[Free]" : `[Wired ×${count}]`}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          <div className="electrical-endpoint-group">
            <small className="electrical-step-label">3. WIRE CONFIGURATION</small>
            <div className="electrical-meta-grid">
              <label className="inspector-inline-field">
                <span>Kind</span>
                <select
                  aria-label="Connection kind"
                  value={draft.connectionType}
                  onChange={(e) =>
                    onDraftChange({
                      connectionType: e.target.value as ElectricalConnectionKind,
                    })
                  }
                >
                  {CONNECTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inspector-inline-field">
                <span>Protocol</span>
                <select
                  aria-label="Signal protocol"
                  value={draft.signalProtocol}
                  onChange={(e) => onDraftChange({ signalProtocol: e.target.value })}
                >
                  <option value="">Auto / None</option>
                  {PROTOCOL_CHOICES.map((proto) => (
                    <option key={proto} value={proto}>
                      {proto.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="electrical-meta-grid">
              <label className="inspector-inline-field">
                <span>Gauge (AWG)</span>
                <input
                  type="number"
                  min={8}
                  max={32}
                  placeholder="e.g. 22"
                  value={draft.wireGaugeAwg}
                  onChange={(e) => onDraftChange({ wireGaugeAwg: e.target.value })}
                />
              </label>
              <label className="inspector-inline-field">
                <span>Color</span>
                <input
                  type="text"
                  placeholder="Red / Black"
                  value={draft.wireColor}
                  onChange={(e) => onDraftChange({ wireColor: e.target.value })}
                />
              </label>
            </div>

            <input
              type="text"
              className="electrical-search-input"
              placeholder="Connection note (optional)..."
              value={draft.notes}
              onChange={(e) => onDraftChange({ notes: e.target.value })}
            />
          </div>

          {liveCompatibility && (
            <div
              className={`workshop-subsystem-card ${
                liveCompatibility.status === "incompatible"
                  ? "error"
                  : liveCompatibility.status === "compatible-with-warnings"
                    ? "warning"
                    : liveCompatibility.status === "unknown"
                      ? "unknown"
                      : "healthy"
              }`}
            >
              <strong>
                Compatibility: {liveCompatibility.status.toUpperCase()}
              </strong>
              <small>{liveCompatibility.reason}</small>
              {liveCompatibility.correctiveAction && (
                <small className="workshop-diag-action">
                  Fix: {liveCompatibility.correctiveAction}
                </small>
              )}
            </div>
          )}

          <button
            type="button"
            className="build-button"
            disabled={!srcSpec || !srcIface || !dstSpec || !dstIface}
            onClick={handleCreate}
          >
            + Create Electrical Connection
          </button>
        </div>
      )}

      {/* Connection Management Panel */}
      <div className="section-label" style={{ marginTop: 14 }}>
        CONNECTIONS ({electricalConnections.length})
      </div>

      <input
        type="search"
        aria-label="Filter electrical connections"
        className="electrical-search-input"
        placeholder="Filter wires by component, kind, or note..."
        value={connSearch}
        onChange={(e) => setConnSearch(e.target.value)}
      />

      <div className="workshop-filter-chips" style={{ marginTop: 6, marginBottom: 8 }}>
        {(
          [
            { id: "all", label: `All (${electricalConnections.length})` },
            { id: "power", label: "Power" },
            { id: "ground", label: "Ground" },
            { id: "signal", label: "Signal" },
            { id: "issues", label: "Issues" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`workshop-chip ${connFilter === tab.id ? "active" : ""}`}
            onClick={() => setConnFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filteredConnections.length === 0 ? (
        <p className="builder-intro">No electrical connections match the active filter.</p>
      ) : (
        <div className="workshop-compat-checks">
          {filteredConnections.map((conn) => {
            const srcName = partById.get(conn.sourcePartId)?.name ?? conn.sourcePartId;
            const dstName = partById.get(conn.targetPartId)?.name ?? conn.targetPartId;
            const compat = connectionResults[conn.id];
            const statusClass =
              compat?.status === "incompatible"
                ? "fail"
                : compat?.status === "compatible-with-warnings"
                  ? "warn"
                  : "pass";
            const isSelected = selectedConnectionId === conn.id;

            return (
              <div
                key={conn.id}
                className={`electrical-conn-row ${statusClass} ${isSelected ? "selected" : ""}`}
              >
                <button
                  type="button"
                  className="electrical-conn-select"
                  onClick={() => onSelectConnection(conn.id)}
                >
                  <strong>
                    [{conn.connectionType.toUpperCase()}] {srcName} → {dstName}
                  </strong>
                  <small className="workshop-compat-hint">
                    {conn.sourcePinId ?? conn.sourceInterfaceId} →{" "}
                    {conn.targetPinId ?? conn.targetInterfaceId}
                    {conn.wireMetadata?.wireGaugeAwg
                      ? ` · ${conn.wireMetadata.wireGaugeAwg} AWG`
                      : ""}
                    {compat ? ` · ${compat.status}` : ""}
                  </small>
                </button>
                <button
                  type="button"
                  className="sim-clear-selection-btn"
                  onClick={() => onRemoveConnection(conn.id)}
                  title="Remove connection"
                >
                  Unwire
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Connection Inspector & Editor */}
      {selectedConn && (
        <div className="workshop-mount-target" style={{ marginTop: 10 }}>
          <div className="section-label">SELECTED CONNECTION EDITOR</div>
          <div className="electrical-quick-nav">
            <button
              type="button"
              className="top-button"
              onClick={() => onSelectPart(selectedConn.sourcePartId)}
            >
              Go to Source
            </button>
            <button
              type="button"
              className="top-button"
              onClick={() => onSelectPart(selectedConn.targetPartId)}
            >
              Go to Target
            </button>
          </div>

          <div className="electrical-meta-grid" style={{ marginTop: 6 }}>
            <label className="inspector-inline-field">
              <span>Wire Type</span>
              <select
                value={selectedConn.connectionType}
                onChange={(e) =>
                  onUpdateConnection(selectedConn.id, {
                    connectionType: e.target.value as ElectricalConnectionKind,
                  })
                }
              >
                {CONNECTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>

            <label className="inspector-inline-field">
              <span>AWG</span>
              <input
                type="number"
                min={8}
                max={32}
                value={selectedConn.wireMetadata?.wireGaugeAwg ?? ""}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onUpdateConnection(selectedConn.id, {
                    wireMetadata: {
                      ...selectedConn.wireMetadata,
                      wireGaugeAwg:
                        e.target.value && Number.isFinite(val) ? val : undefined,
                    },
                  });
                }}
              />
            </label>
          </div>

          {/* Pin Reassignment */}
          {(() => {
            const sSpec = specByPartId.get(selectedConn.sourcePartId);
            const dSpec = specByPartId.get(selectedConn.targetPartId);
            const sIface = sSpec?.interfaces.find(
              (i) => i.interfaceId === selectedConn.sourceInterfaceId
            );
            const dIface = dSpec?.interfaces.find(
              (i) => i.interfaceId === selectedConn.targetInterfaceId
            );
            return (
              <div className="electrical-meta-grid" style={{ marginTop: 6 }}>
                {sIface && sIface.pinIds.length > 0 && (
                  <label className="inspector-inline-field">
                    <span>Source Pin</span>
                    <select
                      value={selectedConn.sourcePinId ?? ""}
                      onChange={(e) =>
                        onAssignPin(
                          selectedConn.id,
                          "source",
                          e.target.value || undefined
                        )
                      }
                    >
                      <option value="">Default</option>
                      {sIface.pinIds.map((pid) => (
                        <option key={pid} value={pid}>
                          {sSpec?.pins.find((p) => p.pinId === pid)?.pinName ?? pid}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {dIface && dIface.pinIds.length > 0 && (
                  <label className="inspector-inline-field">
                    <span>Target Pin</span>
                    <select
                      value={selectedConn.targetPinId ?? ""}
                      onChange={(e) =>
                        onAssignPin(
                          selectedConn.id,
                          "target",
                          e.target.value || undefined
                        )
                      }
                    >
                      <option value="">Default</option>
                      {dIface.pinIds.map((pid) => (
                        <option key={pid} value={pid}>
                          {dSpec?.pins.find((p) => p.pinId === pid)?.pinName ?? pid}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            );
          })()}

          {/* Inline Connector Termination Assignment */}
          <div className="electrical-meta-grid" style={{ marginTop: 6 }}>
            <label className="inspector-inline-field">
              <span>Assign Connector</span>
              <select
                value={connectorPickerTarget}
                onChange={(e) =>
                  setConnectorPickerTarget(
                    e.target.value as ElectricalConnectorCategory
                  )
                }
              >
                {CONNECTOR_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="top-button"
              style={{ alignSelf: "end" }}
              onClick={() => {
                onAssignConnector(
                  selectedConn.targetPartId,
                  selectedConn.targetInterfaceId,
                  {
                    connectorId: `conn-${selectedConn.targetPartId}-${connectorPickerTarget}`,
                    connectorType: connectorPickerTarget,
                    name: `${connectorPickerTarget.toUpperCase()} Termination`,
                    pinCount: 2,
                    pinDefinitions: [],
                    provenance: { method: "user-supplied" },
                  }
                );
              }}
            >
              Apply to Target
            </button>
          </div>

          <input
            type="text"
            className="electrical-search-input"
            style={{ marginTop: 6 }}
            placeholder="Wire notes..."
            value={selectedConn.notes ?? ""}
            onChange={(e) =>
              onUpdateConnection(selectedConn.id, {
                notes: e.target.value || undefined,
              })
            }
          />
        </div>
      )}
    </div>
  );
}
