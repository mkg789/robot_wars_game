import {
  getInstructionCategory,
  type ProgramInstruction,
  type ProgramInstructionKind,
  type ProgramValidationIssue,
  type VisualProgramExecutionTrace,
} from "../../features/programming/types/programWorkspace.types";
import { createDefaultInstruction } from "../../features/programming/logic/programWorkspaceCompiler";

interface InstructionBlockCardProps {
  readonly instruction: ProgramInstruction;
  readonly index: number;
  readonly totalCount: number;
  readonly trace: VisualProgramExecutionTrace;
  readonly issues: readonly ProgramValidationIssue[];
  readonly onUpdate: (
    id: string,
    updater: (cur: ProgramInstruction) => ProgramInstruction
  ) => void;
  readonly onMove: (id: string, direction: "up" | "down") => void;
  readonly onDuplicate: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

const NESTED_ADD_OPTIONS: ReadonlyArray<{
  readonly kind: ProgramInstructionKind;
  readonly label: string;
}> = [
  { kind: "drive", label: "+ Drive" },
  { kind: "turn", label: "+ Turn" },
  { kind: "wait", label: "+ Wait" },
  { kind: "read-ultrasonic", label: "+ Read Sonar" },
  { kind: "stop", label: "+ Stop" },
];

export default function InstructionBlockCard({
  instruction,
  index,
  totalCount,
  trace,
  issues,
  onUpdate,
  onMove,
  onDuplicate,
  onRemove,
}: InstructionBlockCardProps) {
  const category = getInstructionCategory(instruction.kind);
  const isActive = trace.activeInstructionId === instruction.id;
  const isFailed = trace.failedInstructionId === instruction.id;
  const isCompleted = trace.completedInstructionIds.includes(instruction.id);
  const isSkipped =
    !isActive &&
    !isFailed &&
    trace.skippedInstructionIds.includes(instruction.id);
  const repeatProgress =
    instruction.kind === "repeat"
      ? trace.repeatProgressById[instruction.id]
      : undefined;
  const blockIssues = issues.filter((i) => i.instructionId === instruction.id);

  const renderTitle = () => {
    switch (instruction.kind) {
      case "drive":
        return "Drive Straight";
      case "turn":
        return "Pivot Turn";
      case "set-motors":
        return "Set Left / Right Power";
      case "stop":
        return "Stop Motors / Robot";
      case "wait":
        return "Wait (Delay)";
      case "read-ultrasonic":
        return "Read Ultrasonic Distance";
      case "if-ultrasonic":
        return "If Ultrasonic Distance";
      case "repeat":
        return "Repeat Loop";
    }
  };

  return (
    <div
      className={`prog-block cat-${category} ${isActive ? "is-active" : ""} ${
        isFailed ? "is-failed" : ""
      } ${isCompleted && !isActive && !isFailed ? "is-done" : ""} ${
        isSkipped ? "is-skipped" : ""
      }`}
    >
      <div className="prog-block-header">
        <div className="prog-block-title-group">
          <span className={`prog-cat-pill cat-${category}`}>
            {category.toUpperCase()}
          </span>
          <strong>
            {index + 1}. {renderTitle()}
          </strong>
          {isActive && <span className="prog-exec-pill active">RUNNING</span>}
          {isFailed && <span className="prog-exec-pill fault">✕ FAILED</span>}
          {isCompleted && !isActive && !isFailed && (
            <span className="prog-exec-pill done">✓ DONE</span>
          )}
          {isSkipped && (
            <span className="prog-exec-pill skipped">↷ SKIPPED</span>
          )}
          {repeatProgress && (
            <span className="prog-exec-pill repeat">
              Iter {repeatProgress.currentIteration}/{repeatProgress.totalIterations}
            </span>
          )}
        </div>

        <div className="prog-block-actions">
          <button
            type="button"
            className="sim-clear-selection-btn"
            disabled={index === 0}
            onClick={() => onMove(instruction.id, "up")}
            title="Move instruction up"
          >
            ↑
          </button>
          <button
            type="button"
            className="sim-clear-selection-btn"
            disabled={index >= totalCount - 1}
            onClick={() => onMove(instruction.id, "down")}
            title="Move instruction down"
          >
            ↓
          </button>
          <button
            type="button"
            className="sim-clear-selection-btn"
            onClick={() => onDuplicate(instruction.id)}
            title="Duplicate instruction"
          >
            Dup
          </button>
          <button
            type="button"
            className="sim-clear-selection-btn"
            onClick={() => onRemove(instruction.id)}
            title="Delete instruction"
          >
            ×
          </button>
        </div>
      </div>

      {/* Inline Human-Readable Parameter Controls */}
      <div className="prog-block-params">
        {instruction.kind === "drive" && (
          <>
            <label className="inspector-inline-field">
              <span>Direction</span>
              <select
                value={instruction.direction}
                onChange={(e) =>
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "drive"
                      ? {
                          ...cur,
                          direction: e.target.value as "forward" | "backward",
                        }
                      : cur
                  )
                }
              >
                <option value="forward">Forward</option>
                <option value="backward">Backward</option>
              </select>
            </label>
            <label className="inspector-inline-field">
              <span>Power (0–1)</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={instruction.power}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isFinite(val)) return;
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "drive" ? { ...cur, power: val } : cur
                  );
                }}
              />
            </label>
            <label className="inspector-inline-field">
              <span>Duration (s)</span>
              <input
                type="number"
                min={0.1}
                max={60}
                step={0.1}
                value={instruction.durationSeconds}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isFinite(val)) return;
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "drive" ? { ...cur, durationSeconds: val } : cur
                  );
                }}
              />
            </label>
          </>
        )}

        {instruction.kind === "turn" && (
          <>
            <label className="inspector-inline-field">
              <span>Direction</span>
              <select
                value={instruction.direction}
                onChange={(e) =>
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "turn"
                      ? { ...cur, direction: e.target.value as "left" | "right" }
                      : cur
                  )
                }
              >
                <option value="left">Turn Left</option>
                <option value="right">Turn Right</option>
              </select>
            </label>
            <label className="inspector-inline-field">
              <span>Power (0–1)</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={instruction.power}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isFinite(val)) return;
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "turn" ? { ...cur, power: val } : cur
                  );
                }}
              />
            </label>
            <label className="inspector-inline-field">
              <span>Duration (s)</span>
              <input
                type="number"
                min={0.1}
                max={60}
                step={0.1}
                value={instruction.durationSeconds}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isFinite(val)) return;
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "turn" ? { ...cur, durationSeconds: val } : cur
                  );
                }}
              />
            </label>
          </>
        )}

        {instruction.kind === "set-motors" && (
          <>
            <label className="inspector-inline-field">
              <span>Left Power [-1..1]</span>
              <input
                type="number"
                min={-1}
                max={1}
                step={0.05}
                value={instruction.leftPower}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isFinite(val)) return;
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "set-motors" ? { ...cur, leftPower: val } : cur
                  );
                }}
              />
            </label>
            <label className="inspector-inline-field">
              <span>Right Power [-1..1]</span>
              <input
                type="number"
                min={-1}
                max={1}
                step={0.05}
                value={instruction.rightPower}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isFinite(val)) return;
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "set-motors" ? { ...cur, rightPower: val } : cur
                  );
                }}
              />
            </label>
          </>
        )}

        {instruction.kind === "stop" && (
          <label className="inspector-inline-field">
            <span>Target</span>
            <select
              value={instruction.target}
              onChange={(e) =>
                onUpdate(instruction.id, (cur) =>
                  cur.kind === "stop"
                    ? {
                        ...cur,
                        target: e.target.value as
                          | "robot"
                          | "both"
                          | "left"
                          | "right",
                      }
                    : cur
                )
              }
            >
              <option value="robot">Stop Entire Robot</option>
              <option value="both">Stop Both Drive Channels</option>
              <option value="left">Stop Left Motors</option>
              <option value="right">Stop Right Motors</option>
            </select>
          </label>
        )}

        {instruction.kind === "wait" && (
          <label className="inspector-inline-field">
            <span>Wait Time (seconds)</span>
            <input
              type="number"
              min={0.1}
              max={60}
              step={0.1}
              value={instruction.durationSeconds}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!Number.isFinite(val)) return;
                onUpdate(instruction.id, (cur) =>
                  cur.kind === "wait" ? { ...cur, durationSeconds: val } : cur
                );
              }}
            />
          </label>
        )}

        {instruction.kind === "read-ultrasonic" && (
          <small className="workshop-compat-hint">
            Samples installed Ultrasonic sensor distance (cm/m) and records status cleanly.
          </small>
        )}

        {instruction.kind === "if-ultrasonic" && (
          <>
            <label className="inspector-inline-field">
              <span>Condition</span>
              <select
                value={instruction.operator}
                onChange={(e) =>
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "if-ultrasonic"
                      ? {
                          ...cur,
                          operator: e.target.value as "below" | "above",
                        }
                      : cur
                  )
                }
              >
                <option value="below">Distance &lt; Threshold</option>
                <option value="above">Distance &gt; Threshold</option>
              </select>
            </label>
            <label className="inspector-inline-field">
              <span>Threshold (m)</span>
              <input
                type="number"
                min={0.05}
                max={4}
                step={0.1}
                value={instruction.thresholdMeters}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isFinite(val)) return;
                  onUpdate(instruction.id, (cur) =>
                    cur.kind === "if-ultrasonic"
                      ? { ...cur, thresholdMeters: val }
                      : cur
                  );
                }}
              />
            </label>
          </>
        )}

        {instruction.kind === "repeat" && (
          <label className="inspector-inline-field">
            <span>Repeat Count (1–50)</span>
            <input
              type="number"
              min={1}
              max={50}
              step={1}
              value={instruction.count}
              onChange={(e) => {
                const val = Math.round(Number(e.target.value));
                if (!Number.isFinite(val)) return;
                onUpdate(instruction.id, (cur) =>
                  cur.kind === "repeat" ? { ...cur, count: val } : cur
                );
              }}
            />
          </label>
        )}
      </div>

      {/* Nested Branch Containers for Conditional & Repeat */}
      {instruction.kind === "if-ultrasonic" && (
        <div className="prog-branch-wrapper">
          <div className="prog-branch-box">
            <div className="prog-branch-header">
              <span>THEN ({instruction.thenInstructions.length})</span>
              <div className="prog-branch-add-row">
                {NESTED_ADD_OPTIONS.map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    className="workshop-chip"
                    onClick={() =>
                      onUpdate(instruction.id, (cur) =>
                        cur.kind === "if-ultrasonic"
                          ? {
                              ...cur,
                              thenInstructions: [
                                ...cur.thenInstructions,
                                createDefaultInstruction(opt.kind),
                              ],
                            }
                          : cur
                      )
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {instruction.thenInstructions.map((child, cIdx) => (
              <InstructionBlockCard
                key={child.id}
                instruction={child}
                index={cIdx}
                totalCount={instruction.thenInstructions.length}
                trace={trace}
                issues={issues}
                onUpdate={onUpdate}
                onMove={onMove}
                onDuplicate={onDuplicate}
                onRemove={onRemove}
              />
            ))}
          </div>

          <div className="prog-branch-box">
            <div className="prog-branch-header">
              <span>ELSE ({instruction.elseInstructions.length})</span>
              <div className="prog-branch-add-row">
                {NESTED_ADD_OPTIONS.map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    className="workshop-chip"
                    onClick={() =>
                      onUpdate(instruction.id, (cur) =>
                        cur.kind === "if-ultrasonic"
                          ? {
                              ...cur,
                              elseInstructions: [
                                ...cur.elseInstructions,
                                createDefaultInstruction(opt.kind),
                              ],
                            }
                          : cur
                      )
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {instruction.elseInstructions.map((child, cIdx) => (
              <InstructionBlockCard
                key={child.id}
                instruction={child}
                index={cIdx}
                totalCount={instruction.elseInstructions.length}
                trace={trace}
                issues={issues}
                onUpdate={onUpdate}
                onMove={onMove}
                onDuplicate={onDuplicate}
                onRemove={onRemove}
              />
            ))}
          </div>
        </div>
      )}

      {instruction.kind === "repeat" && (
        <div className="prog-branch-wrapper">
          <div className="prog-branch-box">
            <div className="prog-branch-header">
              <span>LOOP BODY ({instruction.bodyInstructions.length})</span>
              <div className="prog-branch-add-row">
                {NESTED_ADD_OPTIONS.map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    className="workshop-chip"
                    onClick={() =>
                      onUpdate(instruction.id, (cur) =>
                        cur.kind === "repeat"
                          ? {
                              ...cur,
                              bodyInstructions: [
                                ...cur.bodyInstructions,
                                createDefaultInstruction(opt.kind),
                              ],
                            }
                          : cur
                      )
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {instruction.bodyInstructions.map((child, cIdx) => (
              <InstructionBlockCard
                key={child.id}
                instruction={child}
                index={cIdx}
                totalCount={instruction.bodyInstructions.length}
                trace={trace}
                issues={issues}
                onUpdate={onUpdate}
                onMove={onMove}
                onDuplicate={onDuplicate}
                onRemove={onRemove}
              />
            ))}
          </div>
        </div>
      )}

      {blockIssues.length > 0 && (
        <div className="prog-block-issues">
          {blockIssues.map((iss, idx) => (
            <small
              key={`${instruction.id}-iss-${idx}`}
              style={{
                color: iss.severity === "error" ? "#fca5a5" : "#fde68a",
              }}
            >
              {iss.severity === "error" ? "✕" : "⚠"} {iss.message}
            </small>
          ))}
        </div>
      )}
    </div>
  );
}
