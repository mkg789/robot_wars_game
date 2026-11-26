import { useState } from "react";
import { BUILTIN_CONTROL_ROUTINES } from "../../features/programming/data/builtInPrograms";
import type {
  MotorChannelTarget,
  RobotProgramControllerState,
} from "../../features/programming/types/control.types";
import type { SimulationWorld } from "../../features/simulation/logic/simulationWorld";

interface SimulationControlPanelProps {
  readonly world: SimulationWorld;
  readonly controlState: RobotProgramControllerState;
}

export default function SimulationControlPanel({
  world,
  controlState,
}: SimulationControlPanelProps) {
  const [selectedRoutineId, setSelectedRoutineId] = useState(
    BUILTIN_CONTROL_ROUTINES[0].id
  );
  const [channelTarget, setChannelTarget] = useState<MotorChannelTarget>("both");
  const [powerDraft, setPowerDraft] = useState(0.5);

  const selectedRoutine =
    BUILTIN_CONTROL_ROUTINES.find((r) => r.id === selectedRoutineId) ??
    BUILTIN_CONTROL_ROUTINES[0];

  const { binding } = controlState;

  return (
    <div className="sim-inspector-section">
      <div className="section-label">PROGRAM &amp; CONTROL FOUNDATION</div>

      <div className="motor-spec-card">
        <div className="property-row">
          <span>Control Source</span>
          <span>{controlState.controlSource.toUpperCase()}</span>
        </div>
        <div className="property-row">
          <span>Program State</span>
          <span>{controlState.programStatus.toUpperCase()}</span>
        </div>
        <div className="property-row">
          <span>Hardware Binding</span>
          <span>
            {binding.electricalMode === "electrically-verified"
              ? "Verified"
              : binding.electricalMode === "electrical-fault"
                ? "Fault Blocked"
                : "Mechanical"}
          </span>
        </div>
        <div className="property-row">
          <span>Left / Right Ch</span>
          <span>
            {binding.leftMotorIds.length} / {binding.rightMotorIds.length} motor(s)
          </span>
        </div>
        <div className="property-row">
          <span>Command Output</span>
          <span>
            L {controlState.leftPower.toFixed(2)} · R {controlState.rightPower.toFixed(2)}
          </span>
        </div>
      </div>

      {binding.faultReason && (
        <div className="sim-runtime-error" role="alert">
          Actuation Blocked: {binding.faultReason}
        </div>
      )}

      {controlState.lastError && (
        <div className="sim-runtime-error" role="alert">
          Program Fault: {controlState.lastError}
        </div>
      )}

      <div className="section-label" style={{ marginTop: 10 }}>
        STARTER AUTONOMOUS ROUTINE
      </div>
      <label className="sim-select-field">
        <span>Program Routine</span>
        <select
          aria-label="Program routine"
          value={selectedRoutineId}
          onChange={(e) => setSelectedRoutineId(e.target.value)}
        >
          {BUILTIN_CONTROL_ROUTINES.map((routine) => (
            <option key={routine.id} value={routine.id}>
              {routine.name}
            </option>
          ))}
        </select>
      </label>
      <p className="builder-intro">{selectedRoutine.description}</p>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          className="primary-button"
          style={{ flex: 1 }}
          disabled={!binding.canDrive}
          onClick={() => {
            world.setProgramRoutine(selectedRoutine);
            world.startProgram();
          }}
        >
          Run Program
        </button>
        <button
          type="button"
          className="top-button"
          onClick={() => world.stopProgram()}
        >
          Stop
        </button>
        <button
          type="button"
          className="top-button"
          onClick={() => world.setManualControlMode()}
          title="Return control authority to W/A/S/D manual controls"
        >
          Manual
        </button>
      </div>

      <div className="section-label" style={{ marginTop: 10 }}>
        DIRECT MOTOR COMMAND API
      </div>
      <div className="electrical-meta-grid">
        <label className="inspector-inline-field">
          <span>Channel</span>
          <select
            aria-label="Motor channel target"
            value={channelTarget}
            onChange={(e) =>
              setChannelTarget(e.target.value as MotorChannelTarget)
            }
          >
            <option value="both">Both</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className="inspector-inline-field">
          <span>Power [-1..1]</span>
          <input
            aria-label="Motor command power"
            type="number"
            min={-1}
            max={1}
            step={0.1}
            value={powerDraft}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setPowerDraft(v);
            }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button
          type="button"
          className="build-button"
          style={{ flex: 1 }}
          onClick={() => {
            if (world.getLifecycleStatus() !== "running") {
              world.start();
            }
            world.setMotorPower(channelTarget, powerDraft);
          }}
        >
          Set Power
        </button>
        <button
          type="button"
          className="top-button"
          onClick={() => world.stopMotors(channelTarget)}
        >
          Stop Ch
        </button>
        <button
          type="button"
          className="sim-drive-btn sim-stop-btn"
          onClick={() => world.stopRobot()}
        >
          Stop Robot
        </button>
      </div>

      {controlState.lastWarnings.length > 0 && (
        <small className="builder-intro" style={{ display: "block", marginTop: 6, color: "#fbbf24" }}>
          {controlState.lastWarnings[0]}
        </small>
      )}
    </div>
  );
}
