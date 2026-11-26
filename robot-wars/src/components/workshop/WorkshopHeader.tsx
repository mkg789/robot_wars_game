import { useRef } from "react";
import type { AssemblyValidationReport } from "../../features/robot-builder/logic/assemblyValidation";

export interface WorkshopHeaderProps {
  readonly projectName: string;
  readonly workspaceMode: "workshop" | "electrical" | "simulation";
  readonly historyPastCount: number;
  readonly historyFutureCount: number;
  readonly validationReport: AssemblyValidationReport;
  readonly electricalConnectionCount: number;
  readonly hasRecoverableAutosave: boolean;
  readonly onChangeProjectName: (name: string) => void;
  readonly onSaveProject: () => void;
  readonly onImportProjectFile: (file: File) => void;
  readonly onRecoverAutosave: () => void;
  readonly onDismissRecoverAutosave: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onOpenValidation: () => void;
  readonly onSetWorkspaceMode: (mode: "workshop" | "electrical" | "simulation") => void;
  readonly onResetBuild: () => void;
}

export function WorkshopHeader({
  projectName,
  workspaceMode,
  historyPastCount,
  historyFutureCount,
  validationReport,
  electricalConnectionCount,
  hasRecoverableAutosave,
  onChangeProjectName,
  onSaveProject,
  onImportProjectFile,
  onRecoverAutosave,
  onDismissRecoverAutosave,
  onUndo,
  onRedo,
  onOpenValidation,
  onSetWorkspaceMode,
  onResetBuild,
}: WorkshopHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-icon">R</div>

        <div>
          <div className="brand-name">ROBOT WARS</div>
          <div className="brand-subtitle">
            ENGINEERING WORKSHOP
          </div>
        </div>
      </div>

      <div className="project-name">
        <span className="status-dot" />
        <input
          type="text"
          className="project-name-input"
          aria-label="Project name"
          value={projectName}
          onChange={(event) => onChangeProjectName(event.target.value)}
          onBlur={(event) => {
            if (!event.currentTarget.value.trim()) {
              onChangeProjectName("Untitled Robot");
            }
          }}
        />
      </div>

      <div className="topbar-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.robotwars.json,application/json"
          style={{ display: "none" }}
          aria-label="Import project file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onImportProjectFile(file);
            }
            event.target.value = "";
          }}
        />
        {hasRecoverableAutosave && (
          <div className="project-recover-group" role="region" aria-label="Project autosave recovery">
            <button
              type="button"
              className="top-button project-recover-btn"
              onClick={onRecoverAutosave}
              title="Restore last browser autosaved project"
            >
              Recover Autosave
            </button>
            <button
              type="button"
              className="top-button"
              onClick={onDismissRecoverAutosave}
              title="Dismiss autosave recovery banner"
              aria-label="Dismiss autosave recovery"
            >
              ×
            </button>
          </div>
        )}
        <button
          type="button"
          className="top-button"
          onClick={onSaveProject}
          title="Save & export complete Robot Wars project (.robotwars.json)"
        >
          Save Project
        </button>
        <button
          type="button"
          className="top-button"
          onClick={() => fileInputRef.current?.click()}
          title="Load Robot Wars project file (.robotwars.json)"
        >
          Load Project
        </button>
        <button
          type="button"
          className="top-button"
          disabled={historyPastCount === 0}
          onClick={onUndo}
          title="Undo last assembly edit"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          className="top-button"
          disabled={historyFutureCount === 0}
          onClick={onRedo}
          title="Redo undone assembly edit"
        >
          ↷ Redo
        </button>
        <button
          type="button"
          className={`top-button workshop-health-btn ${
            validationReport.errors.length > 0
              ? "error"
              : validationReport.warnings.length > 0
                ? "warning"
                : "valid"
          }`}
          onClick={onOpenValidation}
          title="Inspect placement and assembly diagnostics"
        >
          {validationReport.errors.length > 0
            ? `✕ ${validationReport.errors.length} Errors`
            : validationReport.warnings.length > 0
              ? `⚠ ${validationReport.warnings.length} Warnings`
              : "✓ Valid"}
        </button>
        <button
          type="button"
          className={`top-button ${workspaceMode === "workshop" ? "active-mode" : ""}`}
          onClick={() => onSetWorkspaceMode("workshop")}
          title="Switch to 3D Mechanical Workshop"
        >
          3D Workshop
        </button>
        <button
          type="button"
          className={`top-button ${workspaceMode === "electrical" ? "active-mode" : ""}`}
          onClick={() => onSetWorkspaceMode("electrical")}
          title="Open Electrical Catalogue & Wiring Workspace"
        >
          ⚡ Electrical ({electricalConnectionCount})
        </button>
        <button
          type="button"
          className="top-button"
          onClick={onResetBuild}
          title="Reset robot build and clear edit history"
        >
          Reset
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => onSetWorkspaceMode("simulation")}
        >
          Test Robot
        </button>
      </div>
    </header>
  );
}
