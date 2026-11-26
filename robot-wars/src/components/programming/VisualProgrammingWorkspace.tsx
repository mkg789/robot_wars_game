import { useMemo, useState } from "react";
import {
  compileVisualProgramToRoutine,
  createDefaultInstruction,
  duplicateInstruction,
  insertInstruction,
  moveInstruction,
  removeInstruction,
  updateInstruction,
  validateVisualProgram,
} from "../../features/programming/logic/programWorkspaceCompiler";
import {
  createEmptyVisualProgram,
  createStarterPresets,
  deleteSavedVisualProgram,
  loadSavedVisualPrograms,
  saveVisualProgram,
} from "../../features/programming/logic/programPersistence";
import type { RobotProgramControllerState } from "../../features/programming/types/control.types";
import type { RobotSensorsSnapshot } from "../../features/programming/types/sensor.types";
import type {
  InstructionCategory,
  ProgramInstructionKind,
  VisualProgramExecutionTrace,
  VisualRobotProgram,
} from "../../features/programming/types/programWorkspace.types";
import type { SimulationWorld } from "../../features/simulation/logic/simulationWorld";
import InstructionBlockCard from "./InstructionBlockCard";

interface VisualProgrammingWorkspaceProps {
  readonly world: SimulationWorld;
  readonly program: VisualRobotProgram;
  readonly onProgramChange: (program: VisualRobotProgram) => void;
  readonly controlState: RobotProgramControllerState;
  readonly sensorsSnapshot: RobotSensorsSnapshot | null;
  readonly trace: VisualProgramExecutionTrace;
  readonly onTraceChange: (trace: VisualProgramExecutionTrace) => void;
  readonly onSwitchTo3DArena: () => void;
}

const TOOLBOX_ITEMS: ReadonlyArray<{
  readonly kind: ProgramInstructionKind;
  readonly label: string;
  readonly category: InstructionCategory;
  readonly hint: string;
}> = [
  {
    kind: "drive",
    label: "Drive Forward / Back",
    category: "movement",
    hint: "Power & duration",
  },
  {
    kind: "turn",
    label: "Pivot Turn",
    category: "movement",
    hint: "Left / right turn",
  },
  {
    kind: "set-motors",
    label: "Set Motor Power",
    category: "movement",
    hint: "Left & right throttle",
  },
  {
    kind: "stop",
    label: "Stop Motors / Robot",
    category: "movement",
    hint: "Safe zero throttle",
  },
  {
    kind: "read-ultrasonic",
    label: "Read Ultrasonic",
    category: "sensor",
    hint: "Sample obstacle cm",
  },
  {
    kind: "wait",
    label: "Wait",
    category: "logic",
    hint: "Hold for seconds",
  },
  {
    kind: "if-ultrasonic",
    label: "If Ultrasonic Distance",
    category: "logic",
    hint: "Conditional Then / Else",
  },
  {
    kind: "repeat",
    label: "Repeat Sequence",
    category: "logic",
    hint: "Loop N times",
  },
];

const EMPTY_TRACE: VisualProgramExecutionTrace = {
  activeInstructionId: null,
  completedInstructionIds: [],
  lastSensorSummary: null,
  statusMessage: null,
};

export default function VisualProgrammingWorkspace({
  world,
  program,
  onProgramChange,
  controlState,
  sensorsSnapshot,
  trace,
  onTraceChange,
  onSwitchTo3DArena,
}: VisualProgrammingWorkspaceProps) {
  const [savedPrograms, setSavedPrograms] = useState<VisualRobotProgram[]>(() =>
    loadSavedVisualPrograms()
  );
  const presets = useMemo(() => createStarterPresets(), []);

  const issues = useMemo(
    () =>
      validateVisualProgram(program, sensorsSnapshot?.installedSensors),
    [program, sensorsSnapshot]
  );
  const errorCount = issues.filter((i) => i.severity === "error").length;

  const handleRunRoutine = () => {
    const routine = compileVisualProgramToRoutine(program, onTraceChange);
    world.setProgramRoutine(routine);
    world.startProgram();
  };

  const handleStopRoutine = () => {
    world.stopProgram();
    onTraceChange({
      ...trace,
      activeInstructionId: null,
      statusMessage: "Stopped by user",
    });
  };

  const handleResetSimulation = () => {
    world.reset();
    onTraceChange(EMPTY_TRACE);
  };

  const handleSave = () => {
    const updated = saveVisualProgram(program);
    setSavedPrograms(updated);
  };

  const categories: readonly InstructionCategory[] = [
    "movement",
    "sensor",
    "logic",
  ];

  return (
    <>
      {/* LEFT TOOLBOX & SAVED PROGRAMS */}
      <aside className="left-panel">
        <div className="panel-heading">INSTRUCTION TOOLBOX</div>
        <div className="panel-content">
          {categories.map((cat) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div className="section-label">
                {cat === "movement"
                  ? "MOVEMENT"
                  : cat === "sensor"
                    ? "SENSORS"
                    : "LOGIC & FLOW"}
              </div>
              <div className="prog-toolbox-grid">
                {TOOLBOX_ITEMS.filter((t) => t.category === cat).map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    className={`prog-toolbox-btn cat-${item.category}`}
                    onClick={() =>
                      onProgramChange({
                        ...program,
                        instructions: insertInstruction(
                          program.instructions,
                          createDefaultInstruction(item.kind)
                        ),
                      })
                    }
                  >
                    <strong>+ {item.label}</strong>
                    <small>{item.hint}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="section-label" style={{ marginTop: 10 }}>
            STARTER TEMPLATES
          </div>
          <div className="workshop-compat-checks">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="top-button"
                style={{ textAlign: "left" }}
                onClick={() => {
                  onTraceChange(EMPTY_TRACE);
                  onProgramChange({
                    ...preset,
                    id: createEmptyVisualProgram().id,
                  });
                }}
              >
                Load: {preset.name}
              </button>
            ))}
          </div>

          <div className="section-label" style={{ marginTop: 12 }}>
            SAVED ROUTINES ({savedPrograms.length})
          </div>
          {savedPrograms.length === 0 ? (
            <small className="builder-intro">
              Click Save Routine to store routines locally in this browser.
            </small>
          ) : (
            <div className="workshop-compat-checks">
              {savedPrograms.map((saved) => (
                <div className="electrical-installed-item" key={saved.id}>
                  <button
                    type="button"
                    className="electrical-installed-select"
                    onClick={() => {
                      onTraceChange(EMPTY_TRACE);
                      onProgramChange(saved);
                    }}
                  >
                    <strong style={{ fontSize: 11 }}>{saved.name}</strong>
                    <small className="workshop-compat-hint">
                      {saved.instructions.length} step
                      {saved.instructions.length === 1 ? "" : "s"}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="sim-clear-selection-btn"
                    onClick={() =>
                      setSavedPrograms(deleteSavedVisualProgram(saved.id))
                    }
                    title="Delete saved routine"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* CENTER ROUTINE WORKSPACE */}
      <main className="viewport prog-workspace-main">
        <div className="prog-toolbar">
          <input
            aria-label="Routine name"
            type="text"
            className="electrical-search-input prog-name-input"
            value={program.name}
            onChange={(e) =>
              onProgramChange({ ...program, name: e.target.value })
            }
          />
          <button
            type="button"
            className="primary-button"
            disabled={errorCount > 0 || !controlState.binding.canDrive}
            onClick={handleRunRoutine}
          >
            ▶ Run Routine
          </button>
          <button
            type="button"
            className="top-button"
            onClick={handleStopRoutine}
          >
            ■ Stop
          </button>
          <button
            type="button"
            className="top-button"
            onClick={handleResetSimulation}
          >
            ↺ Reset
          </button>
          <button type="button" className="top-button" onClick={handleSave}>
            Save Routine
          </button>
          <button
            type="button"
            className="top-button"
            onClick={() => {
              onTraceChange(EMPTY_TRACE);
              onProgramChange(createEmptyVisualProgram());
            }}
          >
            New Blank
          </button>
          <button
            type="button"
            className="top-button"
            onClick={onSwitchTo3DArena}
          >
            View 3D Arena
          </button>
        </div>

        {/* Live Execution Status & Sensor Banner */}
        <div className="prog-status-bar">
          <span>
            State: <strong>{controlState.programStatus.toUpperCase()}</strong>
          </span>
          <span>
            Motors:{" "}
            <strong>
              L {controlState.leftPower.toFixed(2)} · R{" "}
              {controlState.rightPower.toFixed(2)}
            </strong>
          </span>
          {trace.statusMessage && <span>Trace: {trace.statusMessage}</span>}
          {trace.lastSensorSummary && (
            <span style={{ color: "#38bdf8" }}>{trace.lastSensorSummary}</span>
          )}
        </div>

        {issues.length > 0 && (
          <div className="prog-validation-strip">
            {issues.map((iss, idx) => (
              <small
                key={`global-iss-${idx}`}
                style={{
                  color: iss.severity === "error" ? "#fca5a5" : "#fde68a",
                }}
              >
                {iss.severity === "error" ? "✕" : "⚠"} {iss.message}
              </small>
            ))}
          </div>
        )}

        <div className="prog-sequence-scroll">
          {program.instructions.length === 0 ? (
            <div className="prog-empty-state">
              <div className="foundation-start-icon">◫</div>
              <h3>Empty Robot Routine</h3>
              <p>
                Add Movement, Sensor, or Logic instructions from the toolbox on
                the left, or load a starter template to drive your assembled
                robot cleanly through physics.
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    onProgramChange({
                      ...program,
                      instructions: [createDefaultInstruction("drive")],
                    })
                  }
                >
                  + Add First Drive Step
                </button>
                <button
                  type="button"
                  className="top-button"
                  onClick={() =>
                    onProgramChange({
                      ...presets[0],
                      id: createEmptyVisualProgram().id,
                    })
                  }
                >
                  Load Repeat Demo
                </button>
              </div>
            </div>
          ) : (
            <div className="prog-sequence-list">
              {program.instructions.map((instr, idx) => (
                <InstructionBlockCard
                  key={instr.id}
                  instruction={instr}
                  index={idx}
                  totalCount={program.instructions.length}
                  trace={trace}
                  issues={issues}
                  onUpdate={(id, updater) =>
                    onProgramChange({
                      ...program,
                      instructions: updateInstruction(
                        program.instructions,
                        id,
                        updater
                      ),
                    })
                  }
                  onMove={(id, dir) =>
                    onProgramChange({
                      ...program,
                      instructions: moveInstruction(
                        program.instructions,
                        id,
                        dir
                      ),
                    })
                  }
                  onDuplicate={(id) =>
                    onProgramChange({
                      ...program,
                      instructions: duplicateInstruction(
                        program.instructions,
                        id
                      ),
                    })
                  }
                  onRemove={(id) =>
                    onProgramChange({
                      ...program,
                      instructions: removeInstruction(program.instructions, id),
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
