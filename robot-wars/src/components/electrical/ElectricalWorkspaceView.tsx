import { useMemo, useState } from "react";
import { resolvePartElectricalSpec } from "../../features/electrical/logic/electricalComponentAdapters";
import type { AssemblyValidationReport } from "../../features/robot-builder/logic/assemblyValidation";
import type {
  ElectricalConnection,
  ElectricalConnectorSpec,
  ElectricalDiagnostic,
  ElectricalDiagnosticSeverity,
} from "../../features/electrical/types/electrical.types";
import type {
  AttachmentInterface,
  CustomCollisionConfig,
  FoundationConfig,
  ImportedEngineeringProperties,
  ImportedMeshTransform,
  RobotConnection,
  RobotPart,
  StructuralCatalogueId,
} from "../../features/robot-builder/types/robot.types";
import PartInspectorPanel from "../workshop/PartInspectorPanel";
import ElectricalCataloguePanel from "./ElectricalCataloguePanel";
import ElectricalSchematicCanvas, {
  type DraftPinSelection,
} from "./ElectricalSchematicCanvas";
import ElectricalWiringPanel, {
  type WiringDraftState,
} from "./ElectricalWiringPanel";

interface ElectricalWorkspaceViewProps {
  readonly parts: readonly RobotPart[];
  readonly connections: readonly RobotConnection[];
  readonly foundation: FoundationConfig | null;
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly validationReport: AssemblyValidationReport;
  readonly selectedId: string | null;
  readonly selectedElectricalConnectionId: string | null;
  readonly selectedElectricalPinId: string | null;
  readonly onSelectPart: (partId: string | null) => void;
  readonly onSelectConnection: (connectionId: string | null) => void;
  readonly onFocusDiagnostic: (
    diag: Pick<ElectricalDiagnostic, "partId" | "connectionId" | "pinId">
  ) => void;
  readonly onInstallCatalogueItem: (
    catalogueId: string,
    options?: { parentId?: string }
  ) => string | null;
  readonly onReplaceElectricalComponent: (
    partId: string,
    catalogueId: string
  ) => boolean;
  readonly onDeletePart: (partId: string) => void;
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
  readonly onPreviewTransform: (
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    size?: [number, number, number]
  ) => void;
  readonly onApplyTransform: (
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    size?: [number, number, number]
  ) => void;
  readonly onReplaceStructuralPart: (
    partId: string,
    catalogueId: StructuralCatalogueId
  ) => void;
  readonly onDuplicatePart: (partId: string) => void;
  readonly onAttachPart: (
    childId: string,
    parentId: string,
    parentInterfaceId?: string,
    childInterfaceId?: string
  ) => void;
  readonly onDetachPart: (childId: string) => void;
  readonly onUpdateImportedConfig?: (
    partId: string,
    patch: {
      transform?: Partial<ImportedMeshTransform>;
      engineering?: Partial<ImportedEngineeringProperties>;
      collision?: CustomCollisionConfig;
    }
  ) => void;
  readonly onAddCustomInterface?: (
    partId: string,
    iface: AttachmentInterface
  ) => void;
  readonly onRemoveCustomInterface?: (partId: string, ifaceId: string) => void;
}

export default function ElectricalWorkspaceView({
  parts,
  connections,
  foundation,
  electricalConnections,
  validationReport,
  selectedId,
  selectedElectricalConnectionId,
  selectedElectricalPinId,
  onSelectPart,
  onSelectConnection,
  onFocusDiagnostic,
  onInstallCatalogueItem,
  onReplaceElectricalComponent,
  onDeletePart,
  onCreateConnection,
  onUpdateConnection,
  onAssignPin,
  onAssignConnector,
  onRemoveConnection,
  onPreviewTransform,
  onApplyTransform,
  onReplaceStructuralPart,
  onDuplicatePart,
  onAttachPart,
  onDetachPart,
  onUpdateImportedConfig,
  onAddCustomInterface,
  onRemoveCustomInterface,
}: ElectricalWorkspaceViewProps) {
  const [rightTab, setRightTab] = useState<
    "wiring" | "inspector" | "diagnostics"
  >("wiring");
  const [diagFilter, setDiagFilter] = useState<
    "all" | ElectricalDiagnosticSeverity
  >("all");
  const [draftSourcePort, setDraftSourcePort] =
    useState<DraftPinSelection | null>(null);

  const electricalParts = useMemo(
    () => parts.filter((p) => Boolean(resolvePartElectricalSpec(p))),
    [parts]
  );

  const [draft, setDraft] = useState<WiringDraftState>(() => {
    const first = electricalParts[0];
    const second = electricalParts[1];
    const firstSpec = first ? resolvePartElectricalSpec(first) : null;
    const secondSpec = second ? resolvePartElectricalSpec(second) : null;
    return {
      sourcePartId: first?.id ?? "",
      sourceInterfaceId: firstSpec?.interfaces[0]?.interfaceId ?? "",
      sourcePinId: firstSpec?.interfaces[0]?.pinIds[0] ?? "",
      targetPartId: second?.id ?? "",
      targetInterfaceId: secondSpec?.interfaces[0]?.interfaceId ?? "",
      targetPinId: secondSpec?.interfaces[0]?.pinIds[0] ?? "",
      connectionType: "power",
      signalProtocol: "",
      wireGaugeAwg: "",
      wireColor: "",
      notes: "",
    };
  });

  const electricalReport = validationReport.electricalReport ?? {
    isValid: true,
    healthStatus: "healthy" as const,
    diagnostics: [],
    errorCount: 0,
    warningCount: 0,
    unknownCount: 0,
    connectionResults: {},
  };

  const selectedPart = parts.find((p) => p.id === selectedId) ?? null;
  const selectedPartDiagnostics = selectedPart
    ? (validationReport.diagnosticsByPartId[selectedPart.id] ?? [])
    : [];

  const handlePortClick = (port: DraftPinSelection) => {
    if (!draftSourcePort) {
      setDraftSourcePort(port);
      const spec = parts.find((p) => p.id === port.partId)
        ? resolvePartElectricalSpec(parts.find((p) => p.id === port.partId)!)
        : null;
      const iface = spec?.interfaces.find(
        (i) => i.interfaceId === port.interfaceId
      );
      const inferredKind =
        iface?.role === "ground"
          ? "ground"
          : iface?.role.startsWith("power")
            ? "power"
            : iface?.supportedSignals?.includes("i2c") ||
                iface?.supportedSignals?.includes("spi")
              ? "bus"
              : iface?.supportedSignals?.includes("pwm")
                ? "pwm"
                : "signal";
      setDraft((prev) => ({
        ...prev,
        sourcePartId: port.partId,
        sourceInterfaceId: port.interfaceId,
        sourcePinId: port.pinId ?? "",
        connectionType: inferredKind,
      }));
      onSelectPart(port.partId);
      setRightTab("wiring");
      return;
    }

    if (
      draftSourcePort.partId === port.partId &&
      draftSourcePort.interfaceId === port.interfaceId &&
      draftSourcePort.pinId === port.pinId
    ) {
      setDraftSourcePort(null);
      return;
    }

    setDraft((prev) => ({
      ...prev,
      targetPartId: port.partId,
      targetInterfaceId: port.interfaceId,
      targetPinId: port.pinId ?? "",
    }));
    setDraftSourcePort(null);
    setRightTab("wiring");
  };

  return (
    <div className="main-layout">
      <ElectricalCataloguePanel
        parts={parts}
        electricalConnections={electricalConnections}
        diagnostics={electricalReport.diagnostics}
        selectedId={selectedId}
        onSelectPart={(id) => {
          onSelectPart(id);
          setRightTab("inspector");
        }}
        onInstallCatalogueItem={onInstallCatalogueItem}
        onReplaceElectricalComponent={onReplaceElectricalComponent}
        onRemovePart={onDeletePart}
      />

      <ElectricalSchematicCanvas
        parts={parts}
        electricalConnections={electricalConnections}
        connectionResults={electricalReport.connectionResults}
        diagnostics={electricalReport.diagnostics}
        powerAnalysis={electricalReport.powerAnalysis}
        selectedPartId={selectedId}
        selectedConnectionId={selectedElectricalConnectionId}
        selectedPinId={selectedElectricalPinId}
        draftSourcePort={draftSourcePort}
        onSelectPart={(id) => {
          onSelectPart(id);
          setRightTab("inspector");
        }}
        onSelectConnection={(connId) => {
          onSelectConnection(connId);
          if (connId) setRightTab("wiring");
        }}
        onPortClick={handlePortClick}
        onClearDraftSource={() => setDraftSourcePort(null)}
      />

      <aside className="right-panel">
        <div className="panel-heading">WIRING &amp; ELECTRICAL DIAGNOSTICS</div>

        <div className="workshop-right-tabs" role="tablist" aria-label="Electrical workspace tabs">
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === "wiring"}
            className={`sim-tab-btn ${rightTab === "wiring" ? "active" : ""}`}
            onClick={() => setRightTab("wiring")}
          >
            Wire ({electricalConnections.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === "inspector"}
            className={`sim-tab-btn ${rightTab === "inspector" ? "active" : ""}`}
            onClick={() => setRightTab("inspector")}
          >
            Part
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === "diagnostics"}
            className={`sim-tab-btn ${rightTab === "diagnostics" ? "active" : ""}`}
            onClick={() => setRightTab("diagnostics")}
          >
            Validate ({electricalReport.diagnostics.length})
          </button>
        </div>

        <div className="panel-content">
          {rightTab === "wiring" ? (
            <ElectricalWiringPanel
              parts={parts}
              electricalConnections={electricalConnections}
              connectionResults={electricalReport.connectionResults}
              selectedConnectionId={selectedElectricalConnectionId}
              draft={draft}
              onDraftChange={(patch) =>
                setDraft((prev) => ({ ...prev, ...patch }))
              }
              onCreateConnection={onCreateConnection}
              onUpdateConnection={onUpdateConnection}
              onAssignPin={onAssignPin}
              onAssignConnector={onAssignConnector}
              onRemoveConnection={onRemoveConnection}
              onSelectConnection={(connId) => onSelectConnection(connId)}
              onSelectPart={(partId) => {
                onSelectPart(partId);
                setRightTab("inspector");
              }}
            />
          ) : rightTab === "inspector" ? (
            selectedPart ? (
              <PartInspectorPanel
                key={`${selectedPart.id}-${selectedPart.position.join(",")}-${selectedPart.rotation.join(",")}-${selectedPart.size.join(",")}`}
                part={selectedPart}
                parts={parts}
                connections={connections}
                foundation={foundation}
                diagnostics={selectedPartDiagnostics}
                onPreviewTransform={onPreviewTransform}
                onApplyTransform={onApplyTransform}
                onReplaceStructuralPart={onReplaceStructuralPart}
                onDuplicatePart={onDuplicatePart}
                onAttachPart={onAttachPart}
                onDetachPart={onDetachPart}
                onDeletePart={onDeletePart}
                onUpdateImportedConfig={onUpdateImportedConfig}
                onAddCustomInterface={onAddCustomInterface}
                onRemoveCustomInterface={onRemoveCustomInterface}
                electricalConnections={electricalConnections}
                onRemoveElectricalConnection={onRemoveConnection}
              />
            ) : (
              <div className="placeholder-content">
                <div className="placeholder-icon">⚡</div>
                <p>
                  Select any installed electrical component in the list or schematic to inspect pins, ratings, or mechanical attachment.
                </p>
              </div>
            )
          ) : (
            <div className="workshop-validation-panel">
              <div className="section-label">ELECTRICAL ARCHITECTURE VALIDATION</div>
              <div
                className={`workshop-subsystem-card ${electricalReport.healthStatus}`}
              >
                <strong>
                  Health: {electricalReport.healthStatus.toUpperCase()}
                </strong>
                <small>
                  {electricalReport.errorCount} err · {electricalReport.warningCount} warn ·{" "}
                  {electricalReport.unknownCount} unknown
                </small>
              </div>

              {electricalReport.powerAnalysis &&
                electricalReport.powerAnalysis.rails.length > 0 && (
                  <div className="workshop-mount-target" style={{ marginTop: 8 }}>
                    <div className="section-label">
                      POWER RAILS ({electricalReport.powerAnalysis.rails.length})
                    </div>
                    <div className="workshop-compat-checks">
                      {electricalReport.powerAnalysis.rails.map((rail) => (
                        <button
                          key={rail.railId}
                          type="button"
                          className={`workshop-diag-item ${
                            rail.status === "unknown" ? "info" : rail.status === "healthy" ? "" : rail.status
                          }`}
                          onClick={() => {
                            onSelectPart(rail.sourcePartId);
                            setRightTab("inspector");
                          }}
                        >
                          <strong>{rail.label}</strong>
                          <small className="workshop-compat-hint">
                            {rail.voltageV
                              ? `${rail.voltageV.minV ?? "?"}–${rail.voltageV.maxV ?? "?"}V`
                              : "Voltage unknown"}{" "}
                            · Load: {rail.totalKnownLoadA.toFixed(2)}A
                            {rail.maxContinuousCurrentA !== undefined
                              ? ` / ${rail.maxContinuousCurrentA}A`
                              : ""}
                            {rail.hasUnknownLoadCurrent ? " (+unverified)" : ""} ·{" "}
                            {rail.groundVerified ? "GND OK" : "Missing GND"}
                          </small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              <div className="workshop-filter-chips">
                {(
                  [
                    { id: "all", label: `All (${electricalReport.diagnostics.length})` },
                    { id: "error", label: `Errors (${electricalReport.errorCount})` },
                    { id: "warning", label: `Warnings (${electricalReport.warningCount})` },
                    { id: "unknown", label: `Unknown (${electricalReport.unknownCount})` },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`workshop-chip ${diagFilter === item.id ? "active" : ""}`}
                    onClick={() => setDiagFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {electricalReport.diagnostics.filter(
                (d) => diagFilter === "all" || d.severity === diagFilter
              ).length === 0 ? (
                <p className="builder-intro">
                  No electrical diagnostics in this category.
                </p>
              ) : (
                <div className="workshop-diag-list">
                  {electricalReport.diagnostics
                    .filter((d) => diagFilter === "all" || d.severity === diagFilter)
                    .map((diag) => (
                      <button
                        key={diag.id}
                        type="button"
                        className={`workshop-diag-item ${
                          diag.severity === "unknown" ? "info" : diag.severity
                        }`}
                        onClick={() => {
                          onFocusDiagnostic(diag);
                          if (diag.connectionId) {
                            setRightTab("wiring");
                          } else if (diag.partId) {
                            setRightTab("inspector");
                          }
                        }}
                      >
                        <strong>
                          {diag.title} · {diag.severity.toUpperCase()}
                        </strong>
                        <span>{diag.reason}</span>
                        {diag.correctiveAction && (
                          <small className="workshop-diag-action">
                            Fix: {diag.correctiveAction}
                          </small>
                        )}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
