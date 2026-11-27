import { useState } from "react";
import { foundationModels } from "../../features/robot-builder/data/foundationModels";
import { MOUNTING_PITCH_PRESETS } from "../../features/robot-builder/logic/mountingPatterns";
import {
  PROCEDURAL_ARCHITECTURES,
  RAIL_PROFILE_LABELS,
} from "../../features/robot-builder/logic/proceduralFoundation";
import { handleTabListKeyDown } from "../../features/robot-builder/logic/uiAccessibility";
import type {
  FoundationConfig,
  FoundationModelId,
  FoundationWorkflowMode,
  ProceduralFoundationArchitectureId,
  ProceduralFoundationConfig,
  RailProfileKind,
} from "../../features/robot-builder/types/robot.types";
import StlImportPanel from "./StlImportPanel";

interface FoundationStagePanelProps {
  readonly foundation: FoundationConfig | null;
  readonly onSelectFoundationModel: (modelId: FoundationModelId) => void;
  readonly onConfigureProcedural: (
    patch: Partial<ProceduralFoundationConfig> & {
      architecture?: ProceduralFoundationArchitectureId;
    }
  ) => void;
  readonly onResetProcedural: (arch?: ProceduralFoundationArchitectureId) => void;
  readonly onImportFoundationStl: Parameters<typeof StlImportPanel>[0]["onConfirmImport"];
}

const WORKFLOW_TABS: readonly FoundationWorkflowMode[] = ["procedural", "imported"];

export default function FoundationStagePanel({
  foundation,
  onSelectFoundationModel,
  onConfigureProcedural,
  onResetProcedural,
  onImportFoundationStl,
}: FoundationStagePanelProps) {
  const [workflowTab, setWorkflowTab] = useState<FoundationWorkflowMode>(
    foundation?.mode === "imported" ? "imported" : "procedural"
  );

  const activeArch = foundation?.procedural?.architecture;

  return (
    <>
      <div className="workshop-filter-chips" role="tablist" aria-label="Foundation workflow">
        <button
          type="button"
          role="tab"
          id="foundation-tab-procedural"
          aria-controls="foundation-tabpanel"
          aria-selected={workflowTab === "procedural"}
          tabIndex={workflowTab === "procedural" ? 0 : -1}
          className={`workshop-chip ${workflowTab === "procedural" ? "active" : ""}`}
          onClick={() => setWorkflowTab("procedural")}
          onKeyDown={(e) =>
            handleTabListKeyDown(e, WORKFLOW_TABS, workflowTab, setWorkflowTab)
          }
        >
          Build Foundation
        </button>
        <button
          type="button"
          role="tab"
          id="foundation-tab-imported"
          aria-controls="foundation-tabpanel"
          aria-selected={workflowTab === "imported"}
          tabIndex={workflowTab === "imported" ? 0 : -1}
          className={`workshop-chip ${workflowTab === "imported" ? "active" : ""}`}
          onClick={() => setWorkflowTab("imported")}
          onKeyDown={(e) =>
            handleTabListKeyDown(e, WORKFLOW_TABS, workflowTab, setWorkflowTab)
          }
        >
          Import Foundation (STL)
        </button>
      </div>

      <div
        id="foundation-tabpanel"
        role="tabpanel"
        aria-labelledby={`foundation-tab-${workflowTab}`}
      >

      {workflowTab === "imported" ? (
        <StlImportPanel
          targetKind="foundation"
          onConfirmImport={onImportFoundationStl}
        />
      ) : (
        <>
          <div className="section-label">PROCEDURAL ARCHITECTURES</div>
          <div className="foundation-list">
            {PROCEDURAL_ARCHITECTURES.map((arch) => (
              <button
                key={arch.id}
                type="button"
                className={`foundation-card ${activeArch === arch.id ? "selected" : ""}`}
                onClick={() => onResetProcedural(arch.id)}
              >
                <span className="foundation-card-icon">{arch.icon}</span>
                <span>
                  <strong>{arch.name}</strong>
                  <small>{arch.description}</small>
                </span>
              </button>
            ))}
          </div>

          {foundation?.procedural && (
            <div className="workshop-mount-target">
              <div className="section-label">STRUCTURAL PARAMETERS</div>
              {(foundation.procedural.architecture === "perimeter-frame" ||
                foundation.procedural.architecture === "t-slot-frame" ||
                foundation.procedural.architecture === "patterned-frame" ||
                foundation.procedural.architecture === "hybrid") && (
                <>
                  <label className="sim-select-field">
                    <span>Rail Profile</span>
                    <select
                      aria-label="Rail profile"
                      value={foundation.procedural.railProfile}
                      onChange={(e) =>
                        onConfigureProcedural({
                          railProfile: e.target.value as RailProfileKind,
                        })
                      }
                    >
                      {Object.entries(RAIL_PROFILE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="property-row">
                    <span>Crossmembers</span>
                    <input
                      type="number"
                      aria-label="Crossmember count"
                      min={0}
                      max={8}
                      step={1}
                      value={foundation.procedural.crossmemberCount}
                      onChange={(e) => {
                        const v = Math.round(Number(e.target.value));
                        if (Number.isFinite(v)) {
                          onConfigureProcedural({
                            crossmemberCount: Math.max(0, Math.min(8, v)),
                          });
                        }
                      }}
                    />
                  </div>
                </>
              )}

              <label className="sim-select-field">
                <span>Mounting Grid Pitch</span>
                <select
                  aria-label="Mounting pattern pitch"
                  value={String(foundation.procedural.mountingPattern.spacingXM)}
                  onChange={(e) => {
                    const pitch = Number(e.target.value);
                    if (Number.isFinite(pitch) && pitch > 0 && foundation.procedural) {
                      onConfigureProcedural({
                        mountingPattern: {
                          ...foundation.procedural.mountingPattern,
                          spacingXM: pitch,
                          spacingZM: pitch,
                        },
                      });
                    }
                  }}
                >
                  {MOUNTING_PITCH_PRESETS.map((preset) => (
                    <option key={preset.id} value={String(preset.pitchM)}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="0.12">120 mm Standard Grid</option>
                </select>
              </label>

              <label className="foundation-option">
                <input
                  type="checkbox"
                  checked={foundation.procedural.mountingPattern.enabled}
                  onChange={(e) =>
                    foundation.procedural &&
                    onConfigureProcedural({
                      mountingPattern: {
                        ...foundation.procedural.mountingPattern,
                        enabled: e.target.checked,
                      },
                    })
                  }
                />
                Enable Mounting Pattern Overlay
              </label>
            </div>
          )}

          <div className="section-label" style={{ marginTop: 10 }}>
            QUICK PRESET ENVELOPES
          </div>
          <div className="foundation-list">
            {foundationModels.map((model) => (
              <button
                key={model.id}
                type="button"
                className={`foundation-card ${
                  foundation?.modelId === model.id && !activeArch ? "selected" : ""
                }`}
                onClick={() => onSelectFoundationModel(model.id)}
              >
                <span className="foundation-card-icon">{model.icon}</span>
                <span>
                  <strong>{model.name}</strong>
                  <small>{model.description}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      </div>
    </>
  );
}
