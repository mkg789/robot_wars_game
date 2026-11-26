import { useState } from "react";
import type { ElectricalDiagnostic } from "../../features/electrical/types/electrical.types";
import type { AssemblyValidationReport } from "../../features/robot-builder/logic/assemblyValidation";

export interface WorkshopValidationPanelProps {
  readonly validationReport: AssemblyValidationReport;
  readonly electricalConnectionCount: number;
  readonly lastReplacementWarning: string | null;
  readonly onClearReplacementWarning: () => void;
  readonly onInspectPart: (partId: string) => void;
  readonly onFocusElectricalDiagnostic: (
    diag: Pick<ElectricalDiagnostic, "partId" | "connectionId" | "pinId">
  ) => void;
  readonly onOpenElectricalWorkspace: () => void;
  readonly onOpenPartInspector: () => void;
}

export function WorkshopValidationPanel({
  validationReport,
  electricalConnectionCount,
  lastReplacementWarning,
  onClearReplacementWarning,
  onInspectPart,
  onFocusElectricalDiagnostic,
  onOpenElectricalWorkspace,
  onOpenPartInspector,
}: WorkshopValidationPanelProps) {
  const [diagFilter, setDiagFilter] = useState<"all" | "error" | "warning" | "info">(
    "all"
  );

  const filteredDiagnostics = validationReport.diagnostics.filter(
    (d) => diagFilter === "all" || d.severity === diagFilter
  );

  return (
    <div className="workshop-validation-panel">
      <div className="section-label">ENGINEERING HEALTH &amp; DIAGNOSTICS</div>
      <div
        className={`drivetrain-status ${
          validationReport.healthStatus === "error"
            ? "invalid"
            : validationReport.healthStatus === "warning"
              ? "warning"
              : "valid"
        }`}
        role="status"
      >
        {validationReport.errors.length > 0
          ? `${validationReport.errors.length} error(s), ${validationReport.warnings.length} warning(s)`
          : validationReport.warnings.length > 0
            ? `${validationReport.warnings.length} warning(s), ${validationReport.infos.length} notice(s)`
            : validationReport.infos.length > 0
              ? `Ready · ${validationReport.infos.length} advisory notice(s)`
              : "All mechanical checks passed"}
      </div>

      {lastReplacementWarning && (
        <div className="workshop-diag-item warning" role="alert">
          <strong>REPLACEMENT IMPACT</strong>
          <span>{lastReplacementWarning}</span>
          <button
            type="button"
            className="sim-clear-selection-btn"
            onClick={onClearReplacementWarning}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="workshop-subsystems-grid">
        {validationReport.subsystems.map((sub) => (
          <div
            key={sub.key}
            className={`workshop-subsystem-card ${sub.status}`}
            title={sub.summary}
          >
            <strong>{sub.label}</strong>
            <small>
              {sub.errorCount > 0
                ? `${sub.errorCount} err`
                : sub.warningCount > 0
                  ? `${sub.warningCount} warn`
                  : sub.unknownCount > 0
                    ? `${sub.unknownCount} unverified`
                    : "OK"}
            </small>
          </div>
        ))}
      </div>

      <div className="workshop-filter-chips" role="group" aria-label="Filter diagnostics severity">
        {(
          [
            { id: "all", label: `All (${validationReport.diagnostics.length})` },
            { id: "error", label: `Errors (${validationReport.errors.length})` },
            { id: "warning", label: `Warnings (${validationReport.warnings.length})` },
            { id: "info", label: `Info (${validationReport.infos.length})` },
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

      {filteredDiagnostics.length === 0 ? (
        <p className="builder-intro">
          No diagnostics in this category. Assembly uses 3D OBB SAT checks and explicit interface provenance.
        </p>
      ) : (
        <div className="workshop-diag-list">
          {filteredDiagnostics.map((diag) => (
            <button
              key={diag.id}
              type="button"
              className={`workshop-diag-item ${diag.severity}`}
              onClick={() => {
                if (diag.partId) {
                  onInspectPart(diag.partId);
                }
              }}
            >
              <strong>
                {diag.title ?? diag.severity.toUpperCase()} ·{" "}
                {diag.severity.toUpperCase()}
                {diag.isUnknownAssumption ? " · UNVERIFIED" : ""}
              </strong>
              <span>{diag.message}</span>
              {diag.reason && diag.reason !== diag.message && (
                <small className="workshop-diag-meta">{diag.reason}</small>
              )}
              {diag.correctiveAction && (
                <small className="workshop-diag-action">
                  Fix: {diag.correctiveAction}
                </small>
              )}
            </button>
          ))}
        </div>
      )}

      {validationReport.electricalReport && (
        <div className="workshop-mount-target" style={{ marginTop: 12 }}>
          <div className="section-label">
            ELECTRICAL ARCHITECTURE HEALTH ({electricalConnectionCount} CONNECTIONS)
          </div>
          <div
            className={`workshop-subsystem-card ${validationReport.electricalReport.healthStatus}`}
          >
            <strong>
              Electrical Subsystem: {validationReport.electricalReport.healthStatus.toUpperCase()}
            </strong>
            <small>
              {validationReport.electricalReport.errorCount} err ·{" "}
              {validationReport.electricalReport.warningCount} warn ·{" "}
              {validationReport.electricalReport.unknownCount} unverified specs
            </small>
          </div>
          <button
            type="button"
            className="top-button"
            style={{ width: "100%", marginTop: 6 }}
            onClick={onOpenElectricalWorkspace}
          >
            ⚡ Open Electrical Wiring Workspace
          </button>
          {validationReport.electricalReport.diagnostics.length > 0 && (
            <div className="workshop-diag-list" style={{ marginTop: 6 }}>
              {validationReport.electricalReport.diagnostics.map((eDiag) => (
                <button
                  key={eDiag.id}
                  type="button"
                  className={`workshop-diag-item ${
                    eDiag.severity === "unknown" ? "info" : eDiag.severity
                  }`}
                  onClick={() => {
                    onFocusElectricalDiagnostic(eDiag);
                    if (eDiag.connectionId) {
                      onOpenElectricalWorkspace();
                    } else if (eDiag.partId) {
                      onOpenPartInspector();
                    }
                  }}
                >
                  <strong>
                    [ELECTRICAL] {eDiag.title} · {eDiag.severity.toUpperCase()}
                  </strong>
                  <span>{eDiag.reason}</span>
                  {eDiag.correctiveAction && (
                    <small className="workshop-diag-action">
                      Fix: {eDiag.correctiveAction}
                    </small>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
