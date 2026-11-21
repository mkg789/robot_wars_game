import { Canvas } from "@react-three/fiber";
import { useState, type ReactNode } from "react";
import { useRobotStore } from "./store/robotStore";

import RobotScene from "./components/viewport/RobotScene";
import type { MountCandidate } from "./features/robot-builder/logic/mounting";
import { foundationModels } from "./features/robot-builder/data/foundationModels";
import { motorCatalogue } from "./features/robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "./features/robot-builder/data/wheelCatalogue";
import { generateMotorMountZones } from "./features/robot-builder/logic/mountingZones";

import "./App.css";

type NumericInputProps = {
  value: number;
  onValidChange: (value: number) => void;
  min?: number;
  step?: number;
};

function NumericInput({
  value,
  onValidChange,
  min,
  step = 0.1,
}: NumericInputProps) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={value}
      onChange={(event) => {
        const nextDraft = event.target.value;

        if (nextDraft.trim() === "") return;

        const nextValue = Number(nextDraft);
        if (!Number.isFinite(nextValue)) return;
        if (min !== undefined && nextValue < min) return;

        onValidChange(nextValue);
      }}
      onBlur={(event) => {
        const nextValue = Number(event.currentTarget.value);

        if (
          event.currentTarget.value.trim() === "" ||
          !Number.isFinite(nextValue) ||
          (min !== undefined && nextValue < min)
        ) {
          event.currentTarget.value = String(value);
        }
      }}
    />
  );
}

// --------------------------------------------------
// APPLICATION
// --------------------------------------------------

function App() {
  const [mountCandidate, setMountCandidate] =
    useState<MountCandidate | null>(null);
  const [cameraFocusRequest, setCameraFocusRequest] = useState({
    key: 0,
    length: 2,
    width: 1.5,
    height: 0.35,
  });
  const parts = useRobotStore((state) => state.parts);
  const selectedId = useRobotStore((state) => state.selectedId);
  const transformMode = useRobotStore((state) => state.transformMode);

  const setSelectedId = useRobotStore((state) => state.setSelectedId);
  const mountWheelToMotor = useRobotStore(
    (state) => state.mountWheelToMotor
  );
  const connections = useRobotStore((state) => state.connections);
  const foundation = useRobotStore((state) => state.foundation);
  const startNewBuild = useRobotStore((state) => state.startNewBuild);
  const selectFoundationModel = useRobotStore(
    (state) => state.selectFoundationModel
  );
  const updateFoundationDimensions = useRobotStore(
    (state) => state.updateFoundationDimensions
  );
  const setFoundationOptions = useRobotStore(
    (state) => state.setFoundationOptions
  );
  const confirmFoundation = useRobotStore(
    (state) => state.confirmFoundation
  );
  const stage = useRobotStore((state) => state.stage);
  const setStage = useRobotStore((state) => state.setStage);
  const selectedMotorCatalogueId = useRobotStore(
    (state) => state.selectedMotorCatalogueId
  );
  const selectedMountZoneId = useRobotStore(
    (state) => state.selectedMountZoneId
  );
  const selectMotorCatalogueItem = useRobotStore(
    (state) => state.selectMotorCatalogueItem
  );
  const selectMountZone = useRobotStore(
    (state) => state.selectMountZone
  );
  const placeMotor = useRobotStore((state) => state.placeMotor);
  const replaceMotor = useRobotStore((state) => state.replaceMotor);
  const removeMotor = useRobotStore((state) => state.removeMotor);
  const rotateMotor = useRobotStore((state) => state.rotateMotor);
  const selectedWheelCatalogueId = useRobotStore(
    (state) => state.selectedWheelCatalogueId
  );
  const selectedWheelMotorId = useRobotStore(
    (state) => state.selectedWheelMotorId
  );
  const selectWheelCatalogueItem = useRobotStore(
    (state) => state.selectWheelCatalogueItem
  );
  const selectWheelMotor = useRobotStore((state) => state.selectWheelMotor);
  const assignWheel = useRobotStore((state) => state.assignWheel);
  const removeWheel = useRobotStore((state) => state.removeWheel);
  const finishBuild = useRobotStore((state) => state.finishBuild);

  const childrenByParent = new Map<string, typeof parts>();
  for (const connection of connections) {
    const parentId = connection.parentId ?? connection.sourceId;
    const childId = connection.childId ?? connection.targetId;
    childrenByParent.set(parentId, [
      ...(childrenByParent.get(parentId) ?? []),
      ...(parts.find((part) => part.id === childId)
        ? [parts.find((part) => part.id === childId)!]
        : []),
    ]);
  }

  const renderHierarchy = (partId: string, depth = 0): ReactNode => {
    const part = parts.find((item) => item.id === partId);
    if (!part) return null;

    return (
      <div key={part.id}>
        <div
          className={`tree-item ${
            selectedId === part.id ? "selected" : ""
          }`}
          style={{ paddingLeft: `${10 + depth * 14}px` }}
          onClick={() => setSelectedId(part.id)}
        >
          <span className="tree-icon">
            {childrenByParent.has(part.id) ? "▸" : "▣"}
          </span>
          {part.name}
        </div>
        {(childrenByParent.get(part.id) ?? []).map((child) =>
          renderHierarchy(child.id, depth + 1)
        )}
      </div>
    );
  };

  const attachedChildIds = new Set(
    connections.map(
      (connection) => connection.childId ?? connection.targetId
    )
  );
  const independentParts = parts.filter(
    (part) => !attachedChildIds.has(part.id)
  );
  const mountedMotors = parts.filter(
    (part) => part.type === "Motor" && part.mountingZoneId
  );
  const motorMountZones = foundation
    ? generateMotorMountZones(foundation)
    : [];
  const selectedMotorDefinition = motorCatalogue.find(
    (motor) => motor.id === selectedMotorCatalogueId
  );
  const selectedWheelDefinition = wheelCatalogue.find(
    (wheel) => wheel.id === selectedWheelCatalogueId
  );
  const mountedWheels = parts.filter((part) => part.type === "Wheel");
  const wheelByMotorId = new Map<
    string,
    (typeof mountedWheels)[number]
  >();
  connections
    .filter((connection) => connection.type === "Motor-Wheel")
    .forEach((connection) => {
      const wheel = mountedWheels.find(
        (part) => part.id === connection.childId
      );
      if (wheel) wheelByMotorId.set(connection.parentId, wheel);
    });
  const selectedWheelMotor = mountedMotors.find(
    (motor) => motor.id === selectedWheelMotorId
  );
  const selectedWheelMotorDefinition = motorCatalogue.find(
    (motor) => motor.id === selectedWheelMotor?.motorCatalogueId
  );
  const selectedMotorWheel = selectedWheelMotor
    ? wheelByMotorId.get(selectedWheelMotor.id)
    : undefined;
  const occupiedZoneIds = new Set(
    mountedMotors.map((motor) => motor.mountingZoneId)
  );

  return (
    <div className="workshop">

      {/* HEADER */}
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
          Untitled Robot
        </div>

        <div className="topbar-actions">
          <button className="top-button">Save</button>
          <button className="top-button">Export</button>
          <button className="primary-button">Test Robot</button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="main-layout">

        {/* LEFT PANEL */}
        <aside className="left-panel">
          <div className="panel-content">
            <div className="builder-steps">
              <div className={`builder-step ${stage === "foundation" ? "active" : "complete"}`}>
                <span>1</span>
                Foundation
              </div>
              <div className={`builder-step ${
                stage === "motors"
                  ? "active"
                  : stage === "wheels" || stage === "completed"
                    ? "complete"
                    : ""
              }`}>
                <span>2</span>
                Motors
              </div>
              <div className={`builder-step ${
                stage === "wheels"
                  ? "active"
                  : stage === "completed"
                    ? "complete"
                    : ""
              }`}>
                <span>3</span>
                Wheels
              </div>
            </div>

            {stage === "foundation" && foundation ? (
              <>
                <div className="section-label">FOUNDATION MODEL</div>
                <div className="foundation-list">
                  {foundationModels.map((model) => (
                    <button
                      key={model.id}
                      className={`foundation-card ${
                        foundation.modelId === model.id ? "selected" : ""
                      }`}
                      onClick={() => selectFoundationModel(model.id)}
                    >
                      <span className="foundation-card-icon">
                        {model.icon}
                      </span>
                      <span>
                        <strong>{model.name}</strong>
                        <small>{model.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : stage === "motors" ? (
              <>
                <div className="section-label">MOTOR CATALOGUE</div>
                <div className="motor-list">
                  {motorCatalogue.map((motor) => (
                    <button
                      key={motor.id}
                      className={`motor-card ${
                        selectedMotorCatalogueId === motor.id ? "selected" : ""
                      }`}
                      onClick={() => selectMotorCatalogueItem(motor.id)}
                    >
                      <span
                        className="motor-card-icon"
                        style={{ borderColor: motor.color }}
                      >
                        ⚙
                      </span>
                      <span>
                        <strong>{motor.name}</strong>
                        <small>
                          {motor.rpm} RPM · {motor.torque.toFixed(1)} N·m
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("foundation")}
                >
                  ← Back to Foundation
                </button>
              </>
            ) : stage === "wheels" ? (
              <>
                <div className="section-label">WHEEL CATALOGUE</div>
                <div className="wheel-list">
                  {wheelCatalogue.map((wheel) => (
                    <button
                      key={wheel.id}
                      className={`wheel-card ${
                        selectedWheelCatalogueId === wheel.id ? "selected" : ""
                      }`}
                      onClick={() => selectWheelCatalogueItem(wheel.id)}
                    >
                      <span className="wheel-card-icon">◉</span>
                      <span>
                        <strong>{wheel.name}</strong>
                        <small>
                          {(wheel.diameter * 100).toFixed(0)} cm ×{" "}
                          {(wheel.width * 100).toFixed(1)} cm ·{" "}
                          {wheel.category}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("motors")}
                >
                  ← Back to Motors
                </button>
              </>
            ) : stage === "completed" ? (
              <>
                <div className="section-label">BUILD COMPLETE</div>
                <p className="builder-intro">
                  Your robot configuration is ready to review.
                </p>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("wheels")}
                >
                  ← Edit Wheels
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("motors")}
                >
                  ← Edit Motors
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("foundation")}
                >
                  ← Edit Foundation
                </button>
              </>
            ) : (
              <div className="placeholder-content">
                <p>Start a new robot build to continue.</p>
              </div>
            )}
            {stage === "foundation" && !foundation && (
              <>
                <div className="section-label">NEW ROBOT</div>
                <p className="builder-intro">
                  Choose the foundation that will support your motors and wheels.
                </p>
              </>
            )}
          </div>
          <div className="panel-heading">
            ROBOT STRUCTURE
          </div>

          <div className="panel-content">
            <div className="section-label">
              ASSEMBLY
            </div>

            {independentParts.map((part) => renderHierarchy(part.id))}
          </div>

          <div className="panel-footer">
            <div className="footer-label">
              BUILD STATUS
            </div>

            <div className="build-status">
              <span className="status-dot" />
              Editable Objects
            </div>
          </div>
        </aside>

        {/* 3D VIEWPORT */}
        <main className="viewport">
          <Canvas
            shadows
            camera={{ position: [4.5, 4.2, 6], fov: 44 }}
            gl={{ antialias: true }}
            onPointerMissed={() => setSelectedId(null)}
          >
            <color attach="background" args={["#10151d"]} />

            <RobotScene
              parts={parts}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              transformMode={transformMode}
              mountCandidate={mountCandidate}
              onMountCandidateChange={setMountCandidate}
              cameraFocusRequest={cameraFocusRequest}
            />
          </Canvas>

          {/* VIEWPORT OVERLAY */}
          <div className="viewport-overlay viewport-top-left">
            <div className="overlay-title">
              3D WORKSPACE
            </div>

            <div className="overlay-subtitle">
              Interactive Construction Mode
            </div>
          </div>

          <div className="viewport-overlay viewport-bottom">
            <span>Orbit: Left Mouse</span>
            <span>Zoom: Scroll</span>
            <span>Pan: Right Mouse</span>
          </div>

          <div className="viewport-focus">
            <button
              type="button"
              onClick={() =>
                setCameraFocusRequest((request) => ({
                  key: request.key + 1,
                  length: foundation?.length ?? 2,
                  width: foundation?.width ?? 1.5,
                  height: foundation?.height ?? 0.35,
                }))
              }
              disabled={!foundation}
              title="Center and frame the robot"
            >
              Focus Robot
            </button>
          </div>

          {!foundation && (
            <div className="foundation-start">
              <span className="foundation-start-icon">▣</span>
              <h2>Start a new robot</h2>
              <p>Step 1 begins with choosing and configuring your foundation.</p>
              <button onClick={startNewBuild}>Start Foundation Build</button>
            </div>
          )}

          {mountCandidate && (
            <div className="mount-confirmation" role="dialog">
              <div>Mount this wheel to the motor?</div>
              <div className="mount-actions">
                <button
                  onClick={() => {
                    mountWheelToMotor(
                      mountCandidate.motorId,
                      mountCandidate.wheelId
                    );
                    setMountCandidate(null);
                  }}
                >
                  Mount
                </button>
                <button
                  className="mount-cancel"
                  onClick={() => setMountCandidate(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </main>

        {/* RIGHT PANEL */}
        <aside className="right-panel">
          <div className="panel-heading">
            PROPERTIES
          </div>

          <div className="panel-content">
            {stage === "foundation" && foundation ? (
              <>
                <div className="section-label">FOUNDATION CONFIGURATION</div>

                <div className="object-card">
                  <div className="object-icon">▣</div>
                  <div>
                    <div className="object-name">
                      {foundationModels.find(
                        (model) => model.id === foundation.modelId
                      )?.name}
                    </div>
                    <div className="object-type">Primary robot structure</div>
                  </div>
                </div>

                <div className="property-row">
                  <span>Length</span>
                  <NumericInput
                    value={foundation.length}
                    min={0.8}
                    step={0.1}
                    onValidChange={(length) =>
                      updateFoundationDimensions({ length })
                    }
                  />
                </div>
                <div className="property-row">
                  <span>Width</span>
                  <NumericInput
                    value={foundation.width}
                    min={0.8}
                    step={0.1}
                    onValidChange={(width) =>
                      updateFoundationDimensions({ width })
                    }
                  />
                </div>
                <div className="property-row">
                  <span>Thickness</span>
                  <NumericInput
                    value={foundation.height}
                    min={0.12}
                    step={0.05}
                    onValidChange={(height) =>
                      updateFoundationDimensions({ height })
                    }
                  />
                </div>

                <div className="section-label">STRUCTURAL DETAILS</div>
                <label className="foundation-option">
                  <input
                    type="checkbox"
                    checked={foundation.includeTopPlate}
                    onChange={(event) =>
                      setFoundationOptions({
                        includeTopPlate: event.target.checked,
                      })
                    }
                  />
                  Top structural plate
                </label>
                <label className="foundation-option">
                  <input
                    type="checkbox"
                    checked={foundation.includeFrontCover}
                    onChange={(event) =>
                      setFoundationOptions({
                        includeFrontCover: event.target.checked,
                      })
                    }
                  />
                  Front protective cover
                </label>

                {foundation.confirmed ? (
                  <div className="foundation-confirmed">
                    <span>✓</span>
                    Foundation confirmed
                  </div>
                ) : (
                  <button
                    className="primary-button foundation-confirm"
                    onClick={confirmFoundation}
                  >
                    Confirm Foundation
                  </button>
                )}
              </>
            ) : stage === "motors" ? (
              <>
                <div className="section-label">MOUNTING CONFIGURATION</div>
                {selectedMotorDefinition ? (
                  <div className="motor-spec-card">
                    <div className="motor-spec-title">
                      <span
                        className="motor-card-icon"
                        style={{ borderColor: selectedMotorDefinition.color }}
                      >
                        ⚙
                      </span>
                      <div>
                        <strong>{selectedMotorDefinition.name}</strong>
                        <small>{selectedMotorDefinition.description}</small>
                      </div>
                    </div>
                    <div className="property-row">
                      <span>Weight</span>
                      <span>{selectedMotorDefinition.weight.toFixed(2)} kg</span>
                    </div>
                    <div className="property-row">
                      <span>RPM</span>
                      <span>{selectedMotorDefinition.rpm}</span>
                    </div>
                    <div className="property-row">
                      <span>Torque</span>
                      <span>{selectedMotorDefinition.torque.toFixed(1)} N·m</span>
                    </div>
                    <div className="property-row">
                      <span>Footprint</span>
                      <span>
                        {selectedMotorDefinition.mountingFootprint[0]} ×{" "}
                        {selectedMotorDefinition.mountingFootprint[1]} m
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="builder-intro">Select a motor from the catalogue.</p>
                )}

                <div className="section-label">MOUNTING LOCATIONS</div>
                <div className="mount-zone-list">
                  {motorMountZones.map((zone) => {
                    const occupied = occupiedZoneIds.has(zone.id);
                    return (
                      <button
                        key={zone.id}
                        className={`mount-zone-item ${
                          selectedMountZoneId === zone.id ? "selected" : ""
                        } ${occupied ? "occupied" : ""}`}
                        onClick={() => selectMountZone(zone.id)}
                      >
                        <span>{zone.name}</span>
                        <small>{occupied ? "Occupied" : "Available"}</small>
                      </button>
                    );
                  })}
                </div>

                {selectedMountZoneId && (
                  <div className="motor-actions">
                    {occupiedZoneIds.has(selectedMountZoneId) ? (
                      <>
                        {selectedMotorDefinition && (
                          <button
                            className="primary-button"
                            onClick={() => replaceMotor(selectedMountZoneId)}
                          >
                            Replace Motor
                          </button>
                        )}
                        <button
                          className="danger-button"
                          onClick={() => removeMotor(selectedMountZoneId)}
                        >
                          Remove Motor
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() =>
                            rotateMotor(
                              selectedMountZoneId,
                              mountedMotors.find(
                                (motor) =>
                                  motor.mountingZoneId === selectedMountZoneId
                              )?.rotation[1] === 0
                                ? Math.PI
                                : 0
                            )
                          }
                        >
                          Rotate 180°
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary-button"
                        disabled={!selectedMotorDefinition}
                        onClick={placeMotor}
                      >
                        Add Motor
                      </button>
                    )}
                  </div>
                )}

                <div className="section-label">
                  INSTALLED MOTORS ({mountedMotors.length}/4)
                </div>
                {mountedMotors.length ? (
                  mountedMotors.map((motor) => (
                    <div className="installed-motor" key={motor.id}>
                      <span>{motor.name}</span>
                      <small>
                        {motorMountZones.find(
                          (zone) => zone.id === motor.mountingZoneId
                        )?.name}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="builder-intro">No motors installed.</p>
                )}

                <button
                  className="primary-button foundation-confirm"
                  onClick={() => setStage("wheels")}
                >
                  Continue to Wheels
                </button>
              </>
            ) : stage === "wheels" ? (
              <>
                <div className="section-label">WHEEL SPECIFICATIONS</div>
                {selectedWheelDefinition ? (
                  <div className="motor-spec-card">
                    <div className="motor-spec-title">
                      <span className="wheel-card-icon">◉</span>
                      <div>
                        <strong>{selectedWheelDefinition.name}</strong>
                        <small>{selectedWheelDefinition.description}</small>
                      </div>
                    </div>
                    <div className="property-row">
                      <span>Category</span>
                      <span>{selectedWheelDefinition.category}</span>
                    </div>
                    <div className="property-row">
                      <span>Diameter</span>
                      <span>{(selectedWheelDefinition.diameter * 100).toFixed(0)} cm</span>
                    </div>
                    <div className="property-row">
                      <span>Width</span>
                      <span>{(selectedWheelDefinition.width * 100).toFixed(1)} cm</span>
                    </div>
                    <div className="property-row">
                      <span>Weight</span>
                      <span>{selectedWheelDefinition.weight.toFixed(2)} kg</span>
                    </div>
                    <small className="spec-disclaimer">
                      Placeholder simulation specifications, not manufacturer verified.
                    </small>
                  </div>
                ) : (
                  <p className="builder-intro">
                    Choose a wheel type from the catalogue.
                  </p>
                )}

                <div className="section-label">
                  ASSIGN TO MOTOR ({mountedMotors.length} INSTALLED)
                </div>
                {mountedMotors.length ? (
                  <div className="wheel-motor-list">
                    {mountedMotors.map((motor) => {
                      const assignment = wheelByMotorId.get(motor.id);
                      const motorDefinition = motorCatalogue.find(
                        (item) => item.id === motor.motorCatalogueId
                      );
                      const compatible = Boolean(
                        selectedWheelDefinition &&
                        motor.motorCatalogueId &&
                        selectedWheelDefinition.compatibleMotorIds.includes(
                          motor.motorCatalogueId
                        )
                      );
                      return (
                        <button
                          key={motor.id}
                          className={`wheel-motor-card ${
                            selectedWheelMotorId === motor.id ? "selected" : ""
                          }`}
                          onClick={() => selectWheelMotor(motor.id)}
                        >
                          <span>
                            <strong>{motorDefinition?.name ?? motor.name}</strong>
                            <small>
                              {motorMountZones.find(
                                (zone) => zone.id === motor.mountingZoneId
                              )?.name}
                            </small>
                          </span>
                          <small className={assignment ? "assignment-installed" : ""}>
                            {assignment
                              ? `${assignment.name} · Replace`
                              : selectedWheelDefinition && !compatible
                                ? "Not compatible"
                                : "Unassigned"}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="builder-intro">
                    Install at least one motor in the Motors stage before assigning wheels.
                  </p>
                )}

                {selectedWheelMotor && (
                  <div className="wheel-assignment-actions">
                    <div className="assignment-target">
                      Selected motor:{" "}
                      <strong>
                        {selectedWheelMotorDefinition?.name ?? selectedWheelMotor.name}
                      </strong>
                    </div>
                    {selectedWheelDefinition &&
                      selectedWheelMotor.motorCatalogueId &&
                      !selectedWheelDefinition.compatibleMotorIds.includes(
                        selectedWheelMotor.motorCatalogueId
                      ) && (
                        <p className="compatibility-warning">
                          This wheel is not compatible with the selected motor.
                        </p>
                      )}
                    <button
                      className="primary-button"
                      disabled={
                        !selectedWheelDefinition ||
                        !selectedWheelMotor.motorCatalogueId ||
                        !selectedWheelDefinition.compatibleMotorIds.includes(
                          selectedWheelMotor.motorCatalogueId
                        )
                      }
                      onClick={() => assignWheel(selectedWheelMotor.id)}
                    >
                      {selectedMotorWheel ? "Replace Wheel" : "Mount Wheel"}
                    </button>
                    {selectedMotorWheel && (
                      <button
                        className="danger-button"
                        onClick={() => removeWheel(selectedWheelMotor.id)}
                      >
                        Remove Wheel
                      </button>
                    )}
                  </div>
                )}

                <div className="section-label">
                  INSTALLED WHEELS ({mountedWheels.length})
                </div>
                {mountedMotors.map((motor) => {
                  const wheel = wheelByMotorId.get(motor.id);
                  return (
                    <div className="installed-motor" key={motor.id}>
                      <span>{wheel?.name ?? "No wheel assigned"}</span>
                      <small>
                        {motorMountZones.find(
                          (zone) => zone.id === motor.mountingZoneId
                        )?.name}
                      </small>
                    </div>
                  );
                })}

                <button
                  className="primary-button foundation-confirm"
                  onClick={finishBuild}
                >
                  Finish Build
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("motors")}
                >
                  ← Back to Motors
                </button>
              </>
            ) : stage === "completed" && foundation ? (
              <>
                <div className="section-label">ROBOT BUILD SUMMARY</div>
                <div className="motor-spec-card">
                  <strong>
                    {foundationModels.find(
                      (model) => model.id === foundation.modelId
                    )?.name}
                  </strong>
                  <div className="property-row">
                    <span>Foundation</span>
                    <span>
                      {foundation.length.toFixed(2)} × {foundation.width.toFixed(2)} ×{" "}
                      {foundation.height.toFixed(2)} m
                    </span>
                  </div>
                  <div className="property-row">
                    <span>Installed motors</span>
                    <span>{mountedMotors.length}</span>
                  </div>
                  <div className="property-row">
                    <span>Installed wheels</span>
                    <span>{mountedWheels.length}</span>
                  </div>
                </div>
                <div className="section-label">MOTORS & WHEELS</div>
                {mountedMotors.map((motor) => (
                  <div className="installed-motor" key={motor.id}>
                    <span>{motor.name}</span>
                    <small>
                      {motorMountZones.find(
                        (zone) => zone.id === motor.mountingZoneId
                      )?.name}
                      {" · "}
                      {wheelByMotorId.get(motor.id)?.name ?? "No wheel"}
                    </small>
                  </div>
                ))}
                <button
                  className="stage-back-button"
                  onClick={() => setStage("foundation")}
                >
                  Edit Foundation
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("motors")}
                >
                  Edit Motors
                </button>
                <button
                  className="stage-back-button"
                  onClick={() => setStage("wheels")}
                >
                  Edit Wheels
                </button>
              </>
            ) : (
              <div className="placeholder-content">
                <div className="placeholder-icon">▣</div>
                <p>Start a build to configure your foundation.</p>
              </div>
            )}
          </div>

          <div className="panel-footer">
            <div className="footer-label">
              SYSTEM
            </div>

            <div className="build-status">
              <span className="status-dot" />
              Editor Online
            </div>
          </div>
        </aside>
      </div>

      {/* FOOTER */}
      <footer className="statusbar">
        <span>ROBOT WARS / WORKSHOP</span>
        <span>OBJECTS: {parts.length}</span>
        <span>ENGINE: THREE.JS</span>
      </footer>
    </div>
  );
}

export default App;
