import { useMemo, useRef, useState } from "react";
import { computeElectricalSchematicLayout } from "../../features/electrical/logic/electricalSchematicLayout";
import type {
  ElectricalCompatibilityResult,
  ElectricalConnection,
  ElectricalDiagnostic,
  ElectricalPowerPathAnalysis,
} from "../../features/electrical/types/electrical.types";
import type { RobotPart } from "../../features/robot-builder/types/robot.types";

export interface DraftPinSelection {
  readonly partId: string;
  readonly interfaceId: string;
  readonly pinId?: string;
  readonly label: string;
}

interface ElectricalSchematicCanvasProps {
  readonly parts: readonly RobotPart[];
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly connectionResults: Readonly<Record<string, ElectricalCompatibilityResult>>;
  readonly diagnostics: readonly ElectricalDiagnostic[];
  readonly powerAnalysis?: ElectricalPowerPathAnalysis;
  readonly selectedPartId: string | null;
  readonly selectedConnectionId: string | null;
  readonly selectedPinId: string | null;
  readonly draftSourcePort: DraftPinSelection | null;
  readonly onSelectPart: (partId: string) => void;
  readonly onSelectConnection: (connectionId: string | null) => void;
  readonly onPortClick: (port: DraftPinSelection) => void;
  readonly onClearDraftSource: () => void;
}

export default function ElectricalSchematicCanvas({
  parts,
  electricalConnections,
  connectionResults,
  diagnostics,
  powerAnalysis,
  selectedPartId,
  selectedConnectionId,
  selectedPinId,
  draftSourcePort,
  onSelectPart,
  onSelectConnection,
  onPortClick,
  onClearDraftSource,
}: ElectricalSchematicCanvasProps) {
  const [zoom, setZoom] = useState(0.95);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 18, y: 18 });
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const layout = useMemo(
    () =>
      computeElectricalSchematicLayout({
        parts,
        electricalConnections,
        connectionResults,
        diagnostics,
        powerAnalysis,
      }),
    [parts, electricalConnections, connectionResults, diagnostics, powerAnalysis]
  );

  const resetView = () => {
    setZoom(0.95);
    setPan({ x: 18, y: 18 });
  };

  return (
    <main className="viewport electrical-canvas-stage">
      {/* Top Floating Schematic Toolbar */}
      <div className="viewport-overlay viewport-top-left electrical-canvas-toolbar">
        <div>
          <div className="overlay-title">2D ELECTRICAL WIRING SCHEMATIC</div>
          <div className="overlay-subtitle">
            {layout.nodes.length} component{layout.nodes.length === 1 ? "" : "s"} ·{" "}
            {layout.wires.length} wire{layout.wires.length === 1 ? "" : "s"} ·{" "}
            {draftSourcePort
              ? `Wiring from ${draftSourcePort.label} — click target port`
              : "Click any component pin/port to wire"}
          </div>
        </div>
        {draftSourcePort && (
          <button
            type="button"
            className="sim-clear-selection-btn"
            onClick={onClearDraftSource}
          >
            Cancel Draft Wire
          </button>
        )}
      </div>

      {/* Zoom / Pan Controls */}
      <div className="viewport-focus electrical-zoom-controls">
        <div className="viewport-focus-actions">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.15).toFixed(2))))}
            title="Zoom out schematic"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetView}
            title="Reset schematic zoom & pan"
          >
            {Math.round(zoom * 100)}% · Fit
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))))}
            title="Zoom in schematic"
          >
            +
          </button>
        </div>
      </div>

      {/* Schematic Color Legend */}
      <div className="viewport-overlay viewport-bottom electrical-legend">
        <span className="elec-legend-item">
          <i style={{ background: "#f59e0b" }} /> Power
        </span>
        <span className="elec-legend-item">
          <i style={{ background: "#94a3b8" }} /> Ground (Dashed)
        </span>
        <span className="elec-legend-item">
          <i style={{ background: "#22c55e" }} /> PWM / Bus
        </span>
        <span className="elec-legend-item">
          <i style={{ background: "#38bdf8" }} /> Signal
        </span>
        <span className="elec-legend-item">
          <i style={{ background: "#eab308" }} /> Warning
        </span>
        <span className="elec-legend-item">
          <i style={{ background: "#ef4444" }} /> Fault
        </span>
      </div>

      {layout.nodes.length === 0 ? (
        <div className="foundation-start">
          <span className="foundation-start-icon">⚡</span>
          <h2>Electrical Workspace Ready</h2>
          <p>
            Install batteries, controllers, motor drivers, sensors, or connectors from the left catalogue to begin wiring.
          </p>
        </div>
      ) : (
        <svg
          className="electrical-schematic-svg"
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.08 : -0.08;
            setZoom((z) => Math.min(2.2, Math.max(0.4, Number((z + delta).toFixed(2)))));
          }}
          onPointerDown={(e) => {
            if ((e.target as SVGElement).tagName === "svg" || (e.target as SVGElement).dataset.bg === "true") {
              dragStateRef.current = {
                active: true,
                startX: e.clientX,
                startY: e.clientY,
                origX: pan.x,
                origY: pan.y,
              };
            }
          }}
          onPointerMove={(e) => {
            if (!dragStateRef.current.active) return;
            const dx = e.clientX - dragStateRef.current.startX;
            const dy = e.clientY - dragStateRef.current.startY;
            setPan({
              x: dragStateRef.current.origX + dx,
              y: dragStateRef.current.origY + dy,
            });
          }}
          onPointerUp={() => {
            dragStateRef.current.active = false;
          }}
          onClick={(e) => {
            if ((e.target as SVGElement).dataset.bg === "true") {
              onSelectConnection(null);
            }
          }}
        >
          <defs>
            <pattern
              id="elec-grid-pattern"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 24 0 L 0 0 0 24"
                fill="none"
                stroke="#1c2532"
                strokeWidth="1"
              />
            </pattern>
          </defs>

          <rect
            data-bg="true"
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="url(#elec-grid-pattern)"
          />

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Wires Layer */}
            {layout.wires.map((wire) => {
              const isSelected = selectedConnectionId === wire.connection.id;
              return (
                <g
                  key={wire.connection.id}
                  className="electrical-wire-group"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectConnection(wire.connection.id);
                  }}
                >
                  {/* Transparent hit target */}
                  <path
                    d={wire.pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ cursor: "pointer" }}
                  />
                  {isSelected && (
                    <path
                      d={wire.pathD}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={0.35}
                      strokeWidth={7}
                    />
                  )}
                  <path
                    d={wire.pathD}
                    fill="none"
                    stroke={wire.strokeColor}
                    strokeWidth={isSelected ? 3.5 : 2.3}
                    strokeDasharray={wire.isDashed ? "7 4" : undefined}
                    strokeLinecap="round"
                    style={{ cursor: "pointer" }}
                  />
                  {/* Terminal endpoint dots */}
                  <circle cx={wire.startX} cy={wire.startY} r={3.5} fill={wire.strokeColor} />
                  <circle cx={wire.endX} cy={wire.endY} r={3.5} fill={wire.strokeColor} />

                  {/* Midpoint connection tag */}
                  <g
                    transform={`translate(${wire.labelX}, ${wire.labelY})`}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={-38}
                      y={-10}
                      width={76}
                      height={18}
                      rx={4}
                      fill={isSelected ? "#f59e0b" : "#111827"}
                      stroke={wire.strokeColor}
                      strokeWidth={isSelected ? 1.5 : 1}
                    />
                    <text
                      x={0}
                      y={3}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight={700}
                      fill={isSelected ? "#0f172a" : "#e2e8f0"}
                    >
                      {wire.label.slice(0, 14)}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Component Nodes Layer */}
            {layout.nodes.map((node) => {
              const isSelected = selectedPartId === node.part.id;
              const statusColor =
                node.healthStatus === "error"
                  ? "#ef4444"
                  : node.healthStatus === "warning"
                    ? "#eab308"
                    : node.healthStatus === "unknown"
                      ? "#94a3b8"
                      : "#22c55e";

              return (
                <g key={node.part.id} transform={`translate(${node.x}, ${node.y})`}>
                  <rect
                    x={0}
                    y={0}
                    width={node.width}
                    height={node.height}
                    rx={8}
                    fill="#171e28"
                    stroke={isSelected ? "#f59e0b" : statusColor}
                    strokeWidth={isSelected ? 2.4 : 1.3}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPart(node.part.id);
                    }}
                    style={{ cursor: "pointer" }}
                  />

                  {/* Node Header */}
                  <rect
                    x={1}
                    y={1}
                    width={node.width - 2}
                    height={40}
                    rx={7}
                    fill={isSelected ? "#242f3f" : "#1d2734"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPart(node.part.id);
                    }}
                    style={{ cursor: "pointer" }}
                  />
                  <circle cx={14} cy={16} r={4.5} fill={statusColor} />
                  <text
                    x={26}
                    y={19}
                    fontSize="11.5"
                    fontWeight={700}
                    fill="#f8fafc"
                    style={{ pointerEvents: "none" }}
                  >
                    {node.part.name.length > 24
                      ? `${node.part.name.slice(0, 23)}…`
                      : node.part.name}
                  </text>
                  <text
                    x={26}
                    y={33}
                    fontSize="9.5"
                    fill="#94a3b8"
                    style={{ pointerEvents: "none" }}
                  >
                    {node.spec.componentType} · {node.connectedPinCount}/{node.totalPinCount}
                    {node.powerBadge ? ` · ${node.powerBadge}` : ""}
                  </text>

                  {/* Interactive Pins / Ports */}
                  {node.ports.map((port) => {
                    const relX = port.x - node.x;
                    const relY = port.y - node.y;
                    const isLeft = port.side === "left";
                    const isDraftOrigin =
                      draftSourcePort?.partId === port.partId &&
                      draftSourcePort?.interfaceId === port.interfaceId &&
                      draftSourcePort?.pinId === port.pinId;
                    const isFocusedPin =
                      selectedPartId === port.partId &&
                      selectedPinId !== null &&
                      port.pinId === selectedPinId;
                    const portColor = port.hasError
                      ? "#ef4444"
                      : port.kind === "power"
                        ? "#f59e0b"
                        : port.kind === "ground"
                          ? "#94a3b8"
                          : "#38bdf8";

                    return (
                      <g
                        key={`${port.interfaceId}:${port.pinId ?? "iface"}`}
                        style={{ cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPortClick({
                            partId: port.partId,
                            interfaceId: port.interfaceId,
                            pinId: port.pinId,
                            label: `${node.part.name} · ${port.label}`,
                          });
                        }}
                      >
                        <rect
                          x={isLeft ? 4 : node.width / 2}
                          y={relY - 10}
                          width={node.width / 2 - 4}
                          height={20}
                          rx={4}
                          fill={
                            isDraftOrigin || isFocusedPin
                              ? "#2b3b4e"
                              : "transparent"
                          }
                        />
                        <circle
                          cx={relX}
                          cy={relY}
                          r={isDraftOrigin || isFocusedPin ? 6.5 : 5}
                          fill={port.isConnected ? portColor : "#10151d"}
                          stroke={isDraftOrigin || isFocusedPin ? "#ffffff" : portColor}
                          strokeWidth={isDraftOrigin || isFocusedPin ? 2.2 : 1.8}
                        />
                        <text
                          x={isLeft ? 10 : node.width - 10}
                          y={relY + 3.5}
                          textAnchor={isLeft ? "start" : "end"}
                          fontSize="10"
                          fontWeight={port.isConnected ? 700 : 500}
                          fill={isFocusedPin ? "#fbbf24" : "#e2e8f0"}
                        >
                          {port.label.length > 14
                            ? `${port.label.slice(0, 13)}…`
                            : port.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </main>
  );
}
