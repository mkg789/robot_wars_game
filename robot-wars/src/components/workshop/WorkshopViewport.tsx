import { Canvas } from "@react-three/fiber";
import type { MountCandidate } from "../../features/robot-builder/logic/mounting";
import {
  getAssemblyFocusFrame,
  getComponentFocusFrame,
  type CameraFocusFrame,
  type CameraFocusRequest,
} from "../../features/robot-builder/logic/viewportFocus";
import type {
  FoundationConfig,
  RobotPart,
  TransformMode,
} from "../../features/robot-builder/types/robot.types";
import RobotScene from "../viewport/RobotScene";

export interface WorkshopViewportProps {
  readonly parts: RobotPart[];
  readonly visibleParts: RobotPart[];
  readonly foundation: FoundationConfig | null;
  readonly selectedId: string | null;
  readonly selectedPart: RobotPart | null;
  readonly focusableSelectedPart: RobotPart | null;
  readonly selectedPartIsHidden: boolean;
  readonly transformMode: TransformMode;
  readonly mountCandidate: MountCandidate | null;
  readonly cameraFocusRequest: CameraFocusRequest;
  readonly onSetSelectedId: (id: string | null) => void;
  readonly onSetMountCandidate: (candidate: MountCandidate | null) => void;
  readonly onMountWheelToMotor: (motorId: string, wheelId: string) => void;
  readonly onRequestCameraFocus: (frame: CameraFocusFrame | null) => void;
  readonly onSetTransformMode: (mode: TransformMode) => void;
  readonly onStartNewBuild: () => void;
}

const TRANSFORM_MODES = [
  { id: "select", label: "Select" },
  { id: "translate", label: "Move" },
  { id: "rotate", label: "Rotate" },
  { id: "scale", label: "Scale" },
] as const;

export function WorkshopViewport({
  parts,
  visibleParts,
  foundation,
  selectedId,
  selectedPart,
  focusableSelectedPart,
  selectedPartIsHidden,
  transformMode,
  mountCandidate,
  cameraFocusRequest,
  onSetSelectedId,
  onSetMountCandidate,
  onMountWheelToMotor,
  onRequestCameraFocus,
  onSetTransformMode,
  onStartNewBuild,
}: WorkshopViewportProps) {
  return (
    <main className="viewport">
      <Canvas
        shadows
        camera={{ position: [4.5, 4.2, 6], fov: 44 }}
        gl={{ antialias: true }}
        onPointerMissed={() => onSetSelectedId(null)}
      >
        <color attach="background" args={["#10151d"]} />

        <RobotScene
          parts={parts}
          selectedId={selectedId}
          setSelectedId={onSetSelectedId}
          transformMode={transformMode}
          mountCandidate={mountCandidate}
          onMountCandidateChange={onSetMountCandidate}
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
        <div className="viewport-focus-actions">
          <button
            type="button"
            onClick={() =>
              onRequestCameraFocus(getAssemblyFocusFrame(visibleParts))
            }
            disabled={!foundation || visibleParts.length === 0}
            title="Center and frame the visible robot"
          >
            Focus Robot
          </button>
          <button
            type="button"
            onClick={() => {
              if (focusableSelectedPart) {
                onRequestCameraFocus(
                  getComponentFocusFrame(focusableSelectedPart)
                );
              }
            }}
            disabled={!focusableSelectedPart}
            title={
              selectedPartIsHidden
                ? "Show this component in the Assembly tree before focusing"
                : selectedPart
                  ? "Center and frame the selected component"
                  : "Select a component before focusing"
            }
          >
            Focus Component
          </button>
        </div>
        {selectedPartIsHidden && selectedPart && (
          <div className="viewport-focus-note" role="status">
            {selectedPart.name} is hidden. Show it in the Assembly tree before focusing.
          </div>
        )}
        {foundation &&
          visibleParts.length === 0 &&
          !selectedPartIsHidden && (
            <div className="viewport-focus-note" role="status">
              Show a component to focus the robot.
            </div>
          )}
      </div>

      <div className="view-controls workshop-gizmo-bar" role="group" aria-label="Transform gizmo mode">
        {TRANSFORM_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={transformMode === mode.id ? "tool-active" : ""}
            onClick={() => onSetTransformMode(mode.id)}
            title={`Set viewport gizmo to ${mode.label}`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {!foundation && (
        <div className="foundation-start">
          <span className="foundation-start-icon">▣</span>
          <h2>Start a new robot</h2>
          <p>Step 1 begins with choosing and configuring your foundation.</p>
          <button onClick={onStartNewBuild}>Start Foundation Build</button>
        </div>
      )}

      {mountCandidate && (
        <div className="mount-confirmation" role="dialog">
          <div>Mount this wheel to the motor?</div>
          <div className="mount-actions">
            <button
              onClick={() => {
                onMountWheelToMotor(
                  mountCandidate.motorId,
                  mountCandidate.wheelId
                );
                onSetMountCandidate(null);
              }}
            >
              Mount
            </button>
            <button
              className="mount-cancel"
              onClick={() => onSetMountCandidate(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
