import { useState } from "react";
import { BUILTIN_CONTROL_ROUTINES } from "../../features/programming/data/builtInPrograms";
import type {
  MotorChannelTarget,
  RobotProgramControllerState,
} from "../../features/programming/types/control.types";
import type { RobotSensorsSnapshot } from "../../features/programming/types/sensor.types";
import type { SimulationWorld } from "../../features/simulation/logic/simulationWorld";

interface SimulationControlPanelProps {
  readonly world: SimulationWorld;
  readonly controlState: RobotProgramControllerState;
  readonly sensorsSnapshot: RobotSensorsSnapshot | null;
}

export default function SimulationControlPanel({
  world,
  controlState,
  sensorsSnapshot,
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

      {sensorsSnapshot && (
        <div className="workshop-mount-target" style={{ marginTop: 10 }}>
          <div className="section-label">
            INSTALLED SENSORS ({sensorsSnapshot.installedSensors.length})
          </div>
          {sensorsSnapshot.installedSensors.length === 0 ? (
            <small className="builder-intro">
              No sensors installed. Add Ultrasonic, IR, Line, IMU, or Encoders in ⚡ Electrical.
            </small>
          ) : (
            <div className="motor-spec-card">
              {sensorsSnapshot.installedSensors.map((sensor) => {
                let readingText = sensor.availabilityReason ?? sensor.availability;
                if (sensor.availability === "ready") {
                  if (
                    (sensor.sensorKind === "ultrasonic" ||
                      sensor.sensorKind === "tof-distance") &&
                    sensorsSnapshot.ultrasonic.ok &&
                    sensorsSnapshot.ultrasonic.data
                  ) {
                    const u = world.getControlApi().readUltrasonic(sensor.sensorId);
                    if (u.ok && u.data) {
                      readingText = u.data.inRange
                        ? `${u.data.distanceCm.toFixed(1)} cm`
                        : `>${u.data.maxRangeMeters.toFixed(1)} m (clear)`;
                    }
                  } else if (sensor.sensorKind === "ir-proximity") {
                    const p = world.getControlApi().readProximity(sensor.sensorId);
                    if (p.ok && p.data) {
                      readingText = p.data.detected
                        ? `DETECTED (${((p.data.distanceMeters ?? 0) * 100).toFixed(1)} cm)`
                        : "Clear";
                    }
                  } else if (sensor.sensorKind === "line-sensor") {
                    const l = world.getControlApi().readLineSensor(sensor.sensorId);
                    if (l.ok && l.data) {
                      readingText = `${l.data.channels.map((b) => (b ? "1" : "0")).join("")} · ${l.data.surfaceName}`;
                    }
                  } else if (
                    sensor.sensorKind === "imu" ||
                    sensor.sensorKind === "accelerometer" ||
                    sensor.sensorKind === "gyroscope"
                  ) {
                    const imu = world.getControlApi().readImu(sensor.sensorId);
                    if (imu.ok && imu.data) {
                      readingText = `${imu.data.headingDegrees.toFixed(1)}° · ${imu.data.yawRateDegPerSec.toFixed(1)}°/s`;
                    }
                  } else if (sensor.sensorKind === "encoder") {
                    const enc = world.getControlApi().readEncoder(sensor.sensorId);
                    if (enc.ok && enc.data) {
                      readingText = `${enc.data.ticks} ticks (${enc.data.distanceMeters.toFixed(2)} m)`;
                    }
                  }
                }
                return (
                  <div className="property-row" key={sensor.sensorId}>
                    <span>{sensor.name}</span>
                    <span>{readingText}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
