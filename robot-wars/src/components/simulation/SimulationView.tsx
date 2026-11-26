import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { createStarterPresets } from "../../features/programming/logic/programPersistence";
import type {
  VisualProgramExecutionTrace,
  VisualRobotProgram,
} from "../../features/programming/types/programWorkspace.types";
import { buildAssemblyInspectionSummary } from "../../features/simulation/logic/simulationAssembly";
import {
  computeDefaultSimulationCameraPose,
  type SimulationCameraMode,
  type SimulationCameraPreset,
} from "../../features/simulation/logic/simulationCamera";
import {
  mapKeyboardKeyToDriveAction,
  NEUTRAL_DRIVE_CONTROLS,
  SIMULATION_ARENA_PRESETS,
  SimulationWorld,
} from "../../features/simulation/logic/simulationWorld";
import type {
  SimulationDriveControls,
  SimulationTelemetrySnapshot,
} from "../../features/simulation/types/simulationWorld.types";
import { useRobotStore } from "../../store/robotStore";
import VisualProgrammingWorkspace from "../programming/VisualProgrammingWorkspace";
import SimulationControlPanel from "./SimulationControlPanel";
import SimulationScene from "./SimulationScene";

interface SimulationViewProps {
  readonly onExitSimulation: () => void;
}

type KeyAction = keyof SimulationDriveControls;

const CAMERA_PRESET_OPTIONS: ReadonlyArray<{
  readonly id: SimulationCameraPreset;
  readonly label: string;
}> = [
  { id: "overview", label: "Overview" },
  { id: "front", label: "Front" },
  { id: "rear", label: "Rear" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
];

type LeftPanelTab = "controls" | "program" | "inspector";

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Interactive Simulation Environment (Phase 4.2).
 *
 * Coordinates SimulationWorld lifecycle, keyboard/UI drive controls, 3D viewport,
 * collision visualization, and read-only telemetry presentation.
 */
export default function SimulationView({
  onExitSimulation,
}: SimulationViewProps) {
  const parts = useRobotStore((state) => state.parts);
  const connections = useRobotStore((state) => state.connections);
  const drivetrain = useRobotStore((state) => state.drivetrain);
  const foundation = useRobotStore((state) => state.foundation);
  const electricalConnections = useRobotStore(
    (state) => state.electricalConnections
  );

  const [selectedArenaId, setSelectedArenaId] = useState(
    SIMULATION_ARENA_PRESETS[0].id
  );
  const selectedPreset = useMemo(
    () =>
      SIMULATION_ARENA_PRESETS.find((p) => p.id === selectedArenaId) ??
      SIMULATION_ARENA_PRESETS[0],
    [selectedArenaId]
  );

  // Compile robot configuration once per assembly session
  const initResult = useMemo(
    () =>
      SimulationWorld.fromAssembly({
        parts,
        connections,
        drivetrain,
        foundation,
        electricalConnections,
        arena: SIMULATION_ARENA_PRESETS[0].arena,
      }),
    [parts, connections, drivetrain, foundation, electricalConnections]
  );

  const world = initResult.world;

  const [telemetry, setTelemetry] = useState<SimulationTelemetrySnapshot | null>(
    () => (world ? world.getTelemetrySnapshot() : null)
  );
  const [driveControls, setDriveControls] = useState<SimulationDriveControls>(
    NEUTRAL_DRIVE_CONTROLS
  );
  const [controlState, setControlState] = useState(() =>
    world ? world.getControlState() : null
  );
  const [sensorsSnapshot, setSensorsSnapshot] = useState(() =>
    world ? world.getSensorsSnapshot() : null
  );
  const [simViewMode, setSimViewMode] = useState<"arena" | "programming">(
    "arena"
  );
  const [visualProgram, setVisualProgram] = useState<VisualRobotProgram>(
    () => createStarterPresets()[0]
  );
  const [visualTrace, setVisualTrace] = useState<VisualProgramExecutionTrace>({
    activeInstructionId: null,
    completedInstructionIds: [],
    lastSensorSummary: null,
    statusMessage: null,
  });
  const [cameraMode, setCameraMode] = useState<SimulationCameraMode>("orbit");
  const [cameraPreset, setCameraPreset] =
    useState<SimulationCameraPreset>("overview");
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [leftPanelTab, setLeftPanelTab] = useState<LeftPanelTab>("controls");
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const pressedKeysRef = useRef<Set<KeyAction>>(new Set());

  const inspectionSummary = useMemo(() => {
    if (!world) return null;
    return buildAssemblyInspectionSummary({
      parts,
      connections,
      drivetrain,
      foundation,
      robotConfig: world.getRobotConfig(),
      footprint: world.getRobotFootprint(),
    });
  }, [world, parts, connections, drivetrain, foundation]);

  const activeSelectedPartId =
    selectedPartId &&
    inspectionSummary?.items.some((item) => item.partId === selectedPartId)
      ? selectedPartId
      : null;

  // Lifecycle subscription & cleanup on unmount
  useEffect(() => {
    if (!world) return;
    const pressedKeys = pressedKeysRef.current;
    const unsubscribe = world.subscribe(() => {
      setTelemetry(world.getTelemetrySnapshot());
      setDriveControls(world.getActiveControls());
      setControlState(world.getControlState());
      setSensorsSnapshot(world.getSensorsSnapshot());
    });
    return () => {
      unsubscribe();
      pressedKeys.clear();
      world.dispose();
    };
  }, [world]);

  // Keyboard drive bindings + blur / visibility loss protection
  useEffect(() => {
    if (!world) return;
    const pressedKeys = pressedKeysRef.current;

    const applyKeysToWorld = () => {
      const next: SimulationDriveControls = {
        forward: pressedKeys.has("forward"),
        reverse: pressedKeys.has("reverse"),
        left: pressedKeys.has("left"),
        right: pressedKeys.has("right"),
      };
      world.setDriveControls(next);
      setDriveControls(world.getActiveControls());
    };

    const clearAllInputs = () => {
      pressedKeys.clear();
      world.clearInputs();
      setDriveControls(NEUTRAL_DRIVE_CONTROLS);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;

      if (event.code === "Space") {
        event.preventDefault();
        clearAllInputs();
        return;
      }

      const action = mapKeyboardKeyToDriveAction(event.key);
      if (!action) return;
      event.preventDefault();

      if (!pressedKeys.has(action)) {
        pressedKeys.add(action);
        applyKeysToWorld();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const action = mapKeyboardKeyToDriveAction(event.key);
      if (!action) return;
      if (pressedKeys.delete(action)) {
        applyKeysToWorld();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearAllInputs();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearAllInputs);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearAllInputs);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      pressedKeys.clear();
      world.clearInputs();
    };
  }, [world]);

  // Keep simulation ticking when executing visual routines inside the Program Builder view
  useEffect(() => {
    if (!world || simViewMode !== "programming") return;
    let rafId = 0;
    let prevTs = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0.001, (now - prevTs) / 1000));
      prevTs = now;
      if (world.getLifecycleStatus() === "running") {
        world.stepFrame(dt);
        setTelemetry(world.getTelemetrySnapshot());
        setControlState(world.getControlState());
        setSensorsSnapshot(world.getSensorsSnapshot());
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [world, simViewMode]);

  const setDirectionalControl = (action: KeyAction, active: boolean) => {
    if (!world) return;
    if (active) {
      pressedKeysRef.current.add(action);
    } else {
      pressedKeysRef.current.delete(action);
    }
    world.setDriveControls({
      forward: pressedKeysRef.current.has("forward"),
      reverse: pressedKeysRef.current.has("reverse"),
      left: pressedKeysRef.current.has("left"),
      right: pressedKeysRef.current.has("right"),
    });
    setDriveControls(world.getActiveControls());
  };

  const handleStopAll = () => {
    if (!world) return;
    pressedKeysRef.current.clear();
    world.clearInputs();
    setDriveControls(NEUTRAL_DRIVE_CONTROLS);
  };

  // Invalid configuration / initialization error state
  if (!initResult.success || !world || !telemetry) {
    return (
      <div className="workshop simulation-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-icon">R</div>
            <div>
              <div className="brand-name">ROBOT WARS</div>
              <div className="brand-subtitle">SIMULATION ENVIRONMENT</div>
            </div>
          </div>

          <div className="project-name">
            <span className="status-dot status-dot-error" />
            Simulation Initialization Failed
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="primary-button"
              onClick={onExitSimulation}
            >
              Back to Workshop
            </button>
          </div>
        </header>

        <div className="simulation-error-screen" role="alert">
          <div className="simulation-error-card">
            <div className="section-label">CONFIGURATION VALIDATION</div>
            <h2>Unable to Initialize Simulation</h2>
            <p>
              Complete and validate your robot foundation, battery, motors,
              wheels, and drivetrain mapping in the Workshop before launching
              the physics simulation.
            </p>
            <ul className="simulation-error-list">
              {initResult.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
            <button
              type="button"
              className="primary-button"
              onClick={onExitSimulation}
            >
              Return to Engineering Workshop
            </button>
          </div>
        </div>
      </div>
    );
  }

  const robotConfig = world.getRobotConfig();
  const footprint = world.getRobotFootprint();
  const arena = world.getArena();
  const status = telemetry.lifecycleStatus;
  const runtimeError = world.getLastError();
  const initialCameraPose = computeDefaultSimulationCameraPose(arena);

  const handleSelectCameraPreset = (preset: SimulationCameraPreset) => {
    setCameraPreset(preset);
    if (preset !== "overview") {
      setCameraMode("orbit");
    }
    setCameraResetKey((prev) => prev + 1);
  };

  return (
    <div className="workshop simulation-shell">
      {/* HEADER */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">R</div>
          <div>
            <div className="brand-name">ROBOT WARS</div>
            <div className="brand-subtitle">PLANAR SIMULATION ARENA</div>
          </div>
        </div>

        <div className="project-name">
          <span
            className={`status-dot ${
              status === "running"
                ? ""
                : status === "error"
                  ? "status-dot-error"
                  : "status-dot-paused"
            }`}
          />
          {arena.name} · {status.toUpperCase()}
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className={`top-button ${simViewMode === "arena" ? "active-mode" : ""}`}
            onClick={() => setSimViewMode("arena")}
          >
            3D Arena
          </button>
          <button
            type="button"
            className={`top-button ${simViewMode === "programming" ? "active-mode" : ""}`}
            onClick={() => setSimViewMode("programming")}
          >
            ◫ Program Builder
          </button>
          <button
            type="button"
            className="top-button"
            onClick={() => {
              pressedKeysRef.current.clear();
              world.dispose();
              onExitSimulation();
            }}
          >
            ← Back to Workshop
          </button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="main-layout">
        {simViewMode === "programming" ? (
          <VisualProgrammingWorkspace
            world={world}
            program={visualProgram}
            onProgramChange={setVisualProgram}
            controlState={controlState ?? world.getControlState()}
            sensorsSnapshot={sensorsSnapshot}
            trace={visualTrace}
            onTraceChange={setVisualTrace}
            onSwitchTo3DArena={() => setSimViewMode("arena")}
          />
        ) : (
        <>
        {/* LEFT CONTROL & INSPECTION PANEL */}
        <aside className="left-panel">
          <div className="panel-heading">SIMULATION &amp; ASSEMBLY</div>
          <div className="panel-content">
            <div className="section-label">LIFECYCLE</div>
            <div className="sim-lifecycle-actions">
              {status === "ready" && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => world.start()}
                >
                  Start Simulation
                </button>
              )}
              {status === "running" && (
                <button
                  type="button"
                  className="top-button sim-pause-button"
                  onClick={() => {
                    pressedKeysRef.current.clear();
                    world.pause();
                  }}
                >
                  Pause
                </button>
              )}
              {status === "paused" && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => world.resume()}
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                className={status === "error" ? "primary-button" : "top-button"}
                onClick={() => {
                  pressedKeysRef.current.clear();
                  world.reset();
                }}
              >
                {status === "error" ? "Recover / Reset" : "Reset"}
              </button>
            </div>

            {runtimeError && (
              <div className="sim-runtime-error" role="alert">
                {runtimeError}
              </div>
            )}

            <div className="sim-panel-tabs" role="tablist" aria-label="Left panel views">
              <button
                type="button"
                role="tab"
                aria-selected={leftPanelTab === "controls"}
                className={`sim-tab-btn ${leftPanelTab === "controls" ? "active" : ""}`}
                onClick={() => setLeftPanelTab("controls")}
              >
                Drive &amp; Arena
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={leftPanelTab === "program"}
                className={`sim-tab-btn ${leftPanelTab === "program" ? "active" : ""}`}
                onClick={() => setLeftPanelTab("program")}
              >
                Control API
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={leftPanelTab === "inspector"}
                className={`sim-tab-btn ${leftPanelTab === "inspector" ? "active" : ""}`}
                onClick={() => setLeftPanelTab("inspector")}
              >
                Inspect ({inspectionSummary?.componentCount ?? 0})
              </button>
            </div>

            {leftPanelTab === "controls" ? (
              <>
                <div className="section-label">ARENA SELECTION</div>
            <label className="sim-select-field">
              <span>Arena Configuration</span>
              <select
                aria-label="Simulation arena"
                value={selectedArenaId}
                onChange={(event) => {
                  const nextArenaId = event.target.value;
                  setSelectedArenaId(nextArenaId);
                  const nextPreset = SIMULATION_ARENA_PRESETS.find(
                    (p) => p.id === nextArenaId
                  );
                  if (world && nextPreset) {
                    pressedKeysRef.current.clear();
                    world.setArena(nextPreset.arena);
                  }
                }}
              >
                {SIMULATION_ARENA_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="sim-arena-meta">
              <span>
                {arena.dimensions.lengthM}m × {arena.dimensions.widthM}m
              </span>
              <span>
                {arena.barriers.length} obstacle{arena.barriers.length === 1 ? "" : "s"} ·{" "}
                {arena.surfaceZones.length} zone{arena.surfaceZones.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="builder-intro">{selectedPreset.description}</p>

            <div className="section-label">DRIVE CONTROLS</div>
            <div className="sim-drive-pad" role="group" aria-label="Robot drive controls">
              <div />
              <button
                type="button"
                className={`sim-drive-btn ${driveControls.forward ? "active" : ""}`}
                onPointerDown={() => setDirectionalControl("forward", true)}
                onPointerUp={() => setDirectionalControl("forward", false)}
                onPointerLeave={() => setDirectionalControl("forward", false)}
                onPointerCancel={() => setDirectionalControl("forward", false)}
              >
                ▲ W
              </button>
              <div />
              <button
                type="button"
                className={`sim-drive-btn ${driveControls.left ? "active" : ""}`}
                onPointerDown={() => setDirectionalControl("left", true)}
                onPointerUp={() => setDirectionalControl("left", false)}
                onPointerLeave={() => setDirectionalControl("left", false)}
                onPointerCancel={() => setDirectionalControl("left", false)}
              >
                ◀ A
              </button>
              <button
                type="button"
                className="sim-drive-btn sim-stop-btn"
                onClick={handleStopAll}
              >
                STOP
              </button>
              <button
                type="button"
                className={`sim-drive-btn ${driveControls.right ? "active" : ""}`}
                onPointerDown={() => setDirectionalControl("right", true)}
                onPointerUp={() => setDirectionalControl("right", false)}
                onPointerLeave={() => setDirectionalControl("right", false)}
                onPointerCancel={() => setDirectionalControl("right", false)}
              >
                D ▶
              </button>
              <div />
              <button
                type="button"
                className={`sim-drive-btn ${driveControls.reverse ? "active" : ""}`}
                onPointerDown={() => setDirectionalControl("reverse", true)}
                onPointerUp={() => setDirectionalControl("reverse", false)}
                onPointerLeave={() => setDirectionalControl("reverse", false)}
                onPointerCancel={() => setDirectionalControl("reverse", false)}
              >
                ▼ S
              </button>
              <div />
            </div>
            <p className="sim-key-hint">
              Drive with <strong>W A S D</strong> or <strong>Arrow Keys</strong>.
              Press <strong>Space</strong> to stop.
            </p>

                <div className="section-label">COMPILED ROBOT</div>
                <div className="motor-spec-card">
                  <div className="property-row">
                    <span>Drivetrain</span>
                    <span>{robotConfig.drivetrain.type}</span>
                  </div>
                  <div className="property-row">
                    <span>Mass</span>
                    <span>{robotConfig.totalMassKg.toFixed(2)} kg</span>
                  </div>
                  <div className="property-row">
                    <span>Yaw Inertia (Iyy)</span>
                    <span>{robotConfig.yawInertiaKgM2.toFixed(3)} kg·m²</span>
                  </div>
                  <div className="property-row">
                    <span>OBB Footprint</span>
                    <span>
                      {footprint.lengthM.toFixed(2)} × {footprint.widthM.toFixed(2)} m
                    </span>
                  </div>
                </div>
              </>
            ) : leftPanelTab === "program" ? (
              controlState ? (
                <SimulationControlPanel
                  world={world}
                  controlState={controlState}
                  sensorsSnapshot={sensorsSnapshot}
                  onOpenVisualBuilder={() => setSimViewMode("programming")}
                />
              ) : null
            ) : (
              inspectionSummary && (
                <div className="sim-inspector-section">
                  <div className="section-label">ASSEMBLY SUMMARY</div>
                  <div className="motor-spec-card">
                    <div className="property-row">
                      <span>Foundation</span>
                      <span>{inspectionSummary.foundationLabel}</span>
                    </div>
                    <div className="property-row">
                      <span>Drivetrain</span>
                      <span>{inspectionSummary.drivetrainType}</span>
                    </div>
                    <div className="property-row">
                      <span>Motors / Wheels</span>
                      <span>
                        {inspectionSummary.motorCount} / {inspectionSummary.wheelCount}
                      </span>
                    </div>
                    <div className="property-row">
                      <span>Battery</span>
                      <span>{inspectionSummary.batteryName ?? "None"}</span>
                    </div>
                    <div className="property-row">
                      <span>Controller</span>
                      <span>{inspectionSummary.controllerName ?? "None"}</span>
                    </div>
                    <div className="property-row">
                      <span>Visual Bounds</span>
                      <span>
                        {inspectionSummary.footprint.lengthM.toFixed(2)} ×{" "}
                        {inspectionSummary.footprint.widthM.toFixed(2)} m
                      </span>
                    </div>
                  </div>

                  <div className="sim-inspector-header-row">
                    <div className="section-label">
                      INSTALLED COMPONENTS ({inspectionSummary.componentCount})
                    </div>
                    {activeSelectedPartId && (
                      <button
                        type="button"
                        className="sim-clear-selection-btn"
                        onClick={() => setSelectedPartId(null)}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="sim-component-list">
                    {inspectionSummary.items.map((item) => {
                      const isSelected = activeSelectedPartId === item.partId;
                      return (
                        <button
                          key={item.partId}
                          type="button"
                          className={`sim-component-item ${isSelected ? "selected" : ""}`}
                          aria-pressed={isSelected}
                          onClick={() =>
                            setSelectedPartId((prev) =>
                              prev === item.partId ? null : item.partId
                            )
                          }
                        >
                          <div className="sim-component-top">
                            <span className="sim-component-name">{item.name}</span>
                            <span className="sim-component-badge">{item.categoryLabel}</span>
                          </div>
                          <div className="sim-component-meta">
                            <span>{item.dimensionsLabel}</span>
                            {item.detailTag && <span>{item.detailTag}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            )}
          </div>

          <div className="panel-footer">
            <div className="footer-label">PHYSICS LOOP</div>
            <div className="build-status">
              <span className="status-dot" />
              Fixed 120 Hz Runner
            </div>
          </div>
        </aside>

        {/* SIMULATION 3D VIEWPORT */}
        <main className="viewport">
          <Canvas
            shadows
            camera={{ position: [...initialCameraPose.position], fov: 45 }}
            gl={{ antialias: true }}
          >
            <color attach="background" args={["#0d121a"]} />
            <SimulationScene
              world={world}
              arena={arena}
              collidedBarrierIds={telemetry.collision.collidedBarrierIds}
              cameraMode={cameraMode}
              cameraPreset={cameraPreset}
              cameraResetKey={cameraResetKey}
              onTelemetryTick={(t) => {
                setTelemetry(t);
                setControlState(world.getControlState());
                setSensorsSnapshot(world.getSensorsSnapshot());
              }}
              assemblyParts={parts}
              connections={connections}
              drivetrain={drivetrain}
              selectedPartId={activeSelectedPartId}
            />
          </Canvas>

          <div className="viewport-overlay viewport-top-left">
            <div className="overlay-title">SIMULATION VIEWPORT</div>
            <div className="overlay-subtitle">
              Status: {status.toUpperCase()} · t = {telemetry.timeSeconds.toFixed(2)} s
            </div>
          </div>

          <div className="sim-viewport-top-right">
            <div
              className={`sim-collision-badge ${
                telemetry.collision.hasCollision ? "colliding" : "clear"
              }`}
              role="status"
            >
              {telemetry.collision.hasCollision
                ? `COLLISION (${telemetry.collision.contactCount})`
                : "NO CONTACT"}
            </div>
            <div className="sim-camera-toolbar" role="group" aria-label="Inspection camera views">
              <div className="sim-camera-presets">
                {CAMERA_PRESET_OPTIONS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={cameraPreset === preset.id ? "active" : ""}
                    aria-pressed={cameraPreset === preset.id}
                    onClick={() => handleSelectCameraPreset(preset.id)}
                    title={`Switch to ${preset.label} inspection view without resetting simulation`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="sim-camera-actions">
                <button
                  type="button"
                  className={cameraMode === "follow" ? "active" : ""}
                  aria-pressed={cameraMode === "follow"}
                  onClick={() => {
                    if (cameraMode !== "follow") {
                      setCameraPreset("overview");
                    }
                    setCameraMode((prev) =>
                      prev === "follow" ? "orbit" : "follow"
                    );
                  }}
                  title="Toggle follow camera tracking the robot"
                >
                  {cameraMode === "follow" ? "Following Robot" : "Follow Robot"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCameraPreset("overview");
                    setCameraResetKey((prev) => prev + 1);
                  }}
                  title="Reset camera view without resetting simulation physics"
                >
                  Reset View
                </button>
              </div>
            </div>
          </div>

          <div className="viewport-overlay viewport-bottom">
            <span>Orbit: Left Mouse</span>
            <span>Zoom: Scroll</span>
            <span>Pan: Right Mouse</span>
            <span>Drive: WASD / Arrows</span>
          </div>
        </main>
        </>
        )}

        {/* RIGHT TELEMETRY PANEL */}
        <aside className="right-panel">
          <div className="panel-heading">LIVE TELEMETRY</div>
          <div className="panel-content sim-telemetry-panel">
            <div className="section-label">SESSION</div>
            <div className="motor-spec-card">
              <div className="property-row">
                <span>State</span>
                <span className="sim-mono-val">{status.toUpperCase()}</span>
              </div>
              <div className="property-row">
                <span>Sim Time</span>
                <span className="sim-mono-val">{telemetry.timeSeconds.toFixed(2)} s</span>
              </div>
              <div className="property-row">
                <span>Step Count</span>
                <span className="sim-mono-val">#{telemetry.stepCount}</span>
              </div>
            </div>

            <div className="section-label">POSE (ARENA X-Z)</div>
            <div className="motor-spec-card">
              <div className="property-row">
                <span>Position X</span>
                <span className="sim-mono-val">{telemetry.xMeters.toFixed(3)} m</span>
              </div>
              <div className="property-row">
                <span>Position Z</span>
                <span className="sim-mono-val">{telemetry.zMeters.toFixed(3)} m</span>
              </div>
              <div className="property-row">
                <span>Heading θ</span>
                <span className="sim-mono-val">
                  {telemetry.headingDegrees.toFixed(1)}° ({telemetry.headingRadians.toFixed(2)} rad)
                </span>
              </div>
            </div>

            <div className="section-label">VELOCITIES &amp; ACCELERATION</div>
            <div className="motor-spec-card">
              <div className="property-row">
                <span>Longitudinal Vel</span>
                <span className="sim-mono-val">{telemetry.longitudinalVelocityMps.toFixed(3)} m/s</span>
              </div>
              <div className="property-row">
                <span>Lateral Vel</span>
                <span className="sim-mono-val">{telemetry.lateralVelocityMps.toFixed(3)} m/s</span>
              </div>
              <div className="property-row">
                <span>Angular Vel (ω)</span>
                <span className="sim-mono-val">{telemetry.yawRateRadPerSec.toFixed(3)} rad/s</span>
              </div>
              <div className="property-row">
                <span>Linear Accel</span>
                <span className="sim-mono-val">{telemetry.longitudinalAccelerationMps2.toFixed(3)} m/s²</span>
              </div>
              <div className="property-row">
                <span>Angular Accel</span>
                <span className="sim-mono-val">{telemetry.angularAccelerationRadPerSec2.toFixed(3)} rad/s²</span>
              </div>
            </div>

            <div className="section-label">POWER &amp; BATTERY</div>
            <div
              className={`motor-spec-card ${
                telemetry.isBatteryCutoff ? "sim-card-alert" : ""
              }`}
            >
              <div className="property-row">
                <span>Terminal Voltage</span>
                <span className="sim-mono-val">{telemetry.batteryTerminalVoltageV.toFixed(2)} V</span>
              </div>
              <div className="property-row">
                <span>Current Draw</span>
                <span className="sim-mono-val">{telemetry.totalCurrentDrawA.toFixed(2)} A</span>
              </div>
              <div className="property-row">
                <span>Cutoff Status</span>
                <span
                  className={
                    telemetry.isBatteryCutoff ? "sim-badge-warn" : "sim-badge-ok"
                  }
                >
                  {telemetry.isBatteryCutoff ? "CUTOFF ACTIVE" : "NORMAL"}
                </span>
              </div>
            </div>

            <div className="section-label">COLLISION DIAGNOSTICS</div>
            <div
              className={`motor-spec-card ${
                telemetry.collision.hasCollision ? "sim-card-alert" : ""
              }`}
            >
              <div className="property-row">
                <span>Contact State</span>
                <span
                  className={
                    telemetry.collision.hasCollision
                      ? "sim-badge-warn"
                      : "sim-badge-ok"
                  }
                >
                  {telemetry.collision.hasCollision ? "CONTACT" : "CLEAR"}
                </span>
              </div>
              <div className="property-row">
                <span>Contact Count</span>
                <span className="sim-mono-val">{telemetry.collision.contactCount}</span>
              </div>
              <div className="property-row">
                <span>Normal Impulse</span>
                <span className="sim-mono-val">{telemetry.collision.totalNormalImpulseNs.toFixed(2)} N·s</span>
              </div>
              <div className="property-row">
                <span>Max Penetration</span>
                <span className="sim-mono-val">{(telemetry.collision.maxPenetrationDepthM * 1000).toFixed(2)} mm</span>
              </div>
              {telemetry.collision.collidedBarrierIds.length > 0 && (
                <div className="sim-barrier-list">
                  {telemetry.collision.collidedBarrierIds.map((id) => (
                    <small key={id}>{id}</small>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="panel-footer">
            <div className="footer-label">SIMULATION STEP</div>
            <div className="build-status">
              <span className="status-dot" />
              Step #{telemetry.stepCount}
            </div>
          </div>
        </aside>
      </div>

      {/* FOOTER */}
      <footer className="statusbar">
        <span>ROBOT WARS / SIMULATION</span>
        <span>ARENA: {arena.dimensions.lengthM}m × {arena.dimensions.widthM}m</span>
        <span>ENGINE: DETERMINISTIC 120 Hz + THREE.JS</span>
      </footer>
    </div>
  );
}
