import { Environment, OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import {
  computeDefaultSimulationCameraPose,
  computeFollowCameraDelta,
  computeFollowSimulationCameraPose,
  computeInspectionSimulationCameraPose,
  type SimulationCameraMode,
  type SimulationCameraPreset,
} from "../../features/simulation/logic/simulationCamera";
import type {
  DrivetrainConfiguration,
  RobotConnection,
  RobotPart,
} from "../../features/robot-builder/types/robot.types";
import type { SimulationWorld } from "../../features/simulation/logic/simulationWorld";
import type { ArenaConfig } from "../../features/simulation/types/arena.types";
import type { SimulationTelemetrySnapshot } from "../../features/simulation/types/simulationWorld.types";
import SimulationArenaMesh from "./SimulationArenaMesh";
import SimulationRobotMesh from "./SimulationRobotMesh";

type OrbitControlsHandle = ComponentRef<typeof OrbitControls>;

interface SimulationSceneProps {
  readonly world: SimulationWorld;
  readonly arena: ArenaConfig;
  readonly collidedBarrierIds: readonly string[];
  readonly cameraMode: SimulationCameraMode;
  readonly cameraPreset: SimulationCameraPreset;
  readonly cameraResetKey: number;
  readonly onTelemetryTick: (snapshot: SimulationTelemetrySnapshot) => void;
  readonly assemblyParts?: readonly RobotPart[];
  readonly connections?: readonly RobotConnection[];
  readonly drivetrain?: DrivetrainConfiguration | null;
  readonly selectedPartId?: string | null;
}

const TELEMETRY_SYNC_INTERVAL_SECONDS = 0.08;
const MAX_RENDER_FRAME_DELTA_SECONDS = 0.1;

/**
 * Three.js / React Three Fiber scene driving visual updates from SimulationWorld.
 *
 * Updates robot group position/rotation, wheel spin, and optional follow-camera
 * tracking imperatively inside useFrame so React does not rerender per physics step.
 */
export default function SimulationScene({
  world,
  arena,
  collidedBarrierIds,
  cameraMode,
  cameraPreset,
  cameraResetKey,
  onTelemetryTick,
  assemblyParts,
  connections,
  drivetrain,
  selectedPartId = null,
}: SimulationSceneProps) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsHandle>(null);
  const robotGroupRef = useRef<Group>(null);
  const leftWheelRefs = useRef<(Group | null)[]>([]);
  const rightWheelRefs = useRef<(Group | null)[]>([]);
  const telemetryAccumulatorRef = useRef(0);
  const lastCollisionKeyRef = useRef("");
  const lastStepCountRef = useRef(0);
  const lastProgramStatusRef = useRef(world.getControlState().programStatus);
  const lastActiveInstructionRef = useRef(
    world.getControlState().executionTrace?.activeInstructionId ?? null
  );
  const lastFollowTargetRef = useRef<{ x: number; z: number } | null>(null);

  const defaultCameraPose = useMemo(
    () => computeDefaultSimulationCameraPose(arena),
    [arena]
  );

  const syncVisualPose = (deltaSeconds: number, resetWheelRotation: boolean) => {
    const pose = world.getRenderPose();
    const group = robotGroupRef.current;
    if (group) {
      group.position.set(pose.xMeters, 0, pose.zMeters);
      // In Three.js right-handed space, rotation.y = -headingRadians rotates +X toward +Z
      group.rotation.set(0, -pose.headingRadians, 0);
    }

    for (const wheel of leftWheelRefs.current) {
      if (wheel && wheel.parent) {
        if (resetWheelRotation) {
          wheel.rotation.x = 0;
        } else if (deltaSeconds > 0) {
          const sign =
            typeof wheel.userData?.axleSpinSign === "number"
              ? wheel.userData.axleSpinSign
              : -1;
          wheel.rotation.x +=
            sign * pose.leftWheelAngularVelocityRadPerSec * deltaSeconds;
        }
      }
    }
    for (const wheel of rightWheelRefs.current) {
      if (wheel && wheel.parent) {
        if (resetWheelRotation) {
          wheel.rotation.x = 0;
        } else if (deltaSeconds > 0) {
          const sign =
            typeof wheel.userData?.axleSpinSign === "number"
              ? wheel.userData.axleSpinSign
              : 1;
          wheel.rotation.x +=
            sign * pose.rightWheelAngularVelocityRadPerSec * deltaSeconds;
        }
      }
    }
  };

  // Sync pose on world or arena switch
  useEffect(() => {
    syncVisualPose(0, true);
    lastStepCountRef.current = world.getRunnerState().totalPhysicsSteps;
    const pose = world.getRenderPose();
    lastFollowTargetRef.current = { x: pose.xMeters, z: pose.zMeters };
    const snapshot = world.getTelemetrySnapshot();
    lastCollisionKeyRef.current = snapshot.collision.collidedBarrierIds.join("|");
    onTelemetryTick(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, arena]);

  // Apply explicit camera preset or reset (or arena change) without affecting simulation physics
  useEffect(() => {
    const controls = controlsRef.current;
    const pose = world.getRenderPose();
    const targetPose =
      cameraMode === "follow" && cameraPreset === "overview"
        ? computeFollowSimulationCameraPose(pose, arena)
        : computeInspectionSimulationCameraPose({
            preset: cameraPreset,
            arena,
            robotPose: pose,
            footprint: world.getRobotFootprint(),
          });

    camera.position.set(...targetPose.position);
    if (controls) {
      controls.target.set(...targetPose.target);
      controls.update();
    } else {
      camera.lookAt(...targetPose.target);
    }
    lastFollowTargetRef.current = { x: pose.xMeters, z: pose.zMeters };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPreset, cameraResetKey, arena]);

  // Re-center follow reference when toggling follow mode without resetting physics
  useEffect(() => {
    const pose = world.getRenderPose();
    const controls = controlsRef.current;
    if (cameraMode === "follow") {
      const followPose = computeFollowSimulationCameraPose(pose, arena);
      camera.position.set(...followPose.position);
      if (controls) {
        controls.target.set(...followPose.target);
        controls.update();
      }
      lastFollowTargetRef.current = { x: pose.xMeters, z: pose.zMeters };
    } else {
      lastFollowTargetRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode]);

  useFrame((frameState, rawDelta) => {
    const clampedDelta = Math.min(
      Math.max(0, Number.isFinite(rawDelta) ? rawDelta : 0),
      MAX_RENDER_FRAME_DELTA_SECONDS
    );
    const status = world.getLifecycleStatus();
    if (status === "running") {
      world.stepFrame(clampedDelta);
    }
    const postStatus = world.getLifecycleStatus();

    const currentSteps = world.getRunnerState().totalPhysicsSteps;
    const didReset = currentSteps === 0 && lastStepCountRef.current > 0;
    lastStepCountRef.current = currentSteps;

    syncVisualPose(postStatus === "running" ? clampedDelta : 0, didReset);

    // Optional follow-camera tracking via incremental target/position translation
    if (cameraMode === "follow") {
      const pose = world.getRenderPose();
      const prev = lastFollowTargetRef.current ?? {
        x: pose.xMeters,
        z: pose.zMeters,
      };
      const { dx, dz } = computeFollowCameraDelta(prev, pose);
      if (Math.abs(dx) > 1e-7 || Math.abs(dz) > 1e-7) {
        const activeCamera = frameState.camera;
        activeCamera.position.set(
          activeCamera.position.x + dx,
          activeCamera.position.y,
          activeCamera.position.z + dz
        );
        const controls = controlsRef.current;
        if (controls) {
          controls.target.set(
            controls.target.x + dx,
            controls.target.y,
            controls.target.z + dz
          );
          controls.update();
        }
      }
      lastFollowTargetRef.current = { x: pose.xMeters, z: pose.zMeters };
    }

    const collision = world.getCollisionIndicator();
    const collisionKey = collision.collidedBarrierIds.join("|");
    const collisionChanged = collisionKey !== lastCollisionKeyRef.current;
    const ctrlState = world.getControlState();
    const nextActiveInstr = ctrlState.executionTrace?.activeInstructionId ?? null;
    const programStateChanged =
      ctrlState.programStatus !== lastProgramStatusRef.current ||
      nextActiveInstr !== lastActiveInstructionRef.current;

    if (postStatus !== "running") {
      telemetryAccumulatorRef.current = 0;
      if (collisionChanged || programStateChanged) {
        lastCollisionKeyRef.current = collisionKey;
        lastProgramStatusRef.current = ctrlState.programStatus;
        lastActiveInstructionRef.current = nextActiveInstr;
        onTelemetryTick(world.getTelemetrySnapshot());
      }
      return;
    }

    telemetryAccumulatorRef.current += clampedDelta;
    if (
      collisionChanged ||
      programStateChanged ||
      telemetryAccumulatorRef.current >= TELEMETRY_SYNC_INTERVAL_SECONDS
    ) {
      telemetryAccumulatorRef.current = 0;
      lastCollisionKeyRef.current = collisionKey;
      lastProgramStatusRef.current = ctrlState.programStatus;
      lastActiveInstructionRef.current = nextActiveInstr;
      onTelemetryTick(world.getTelemetrySnapshot());
    }
  });

  const arenaSpan = Math.max(arena.dimensions.lengthM, arena.dimensions.widthM);

  return (
    <>
      <hemisphereLight args={["#e2edf7", "#1e293b", 0.72]} />
      <ambientLight intensity={0.38} />
      <directionalLight
        position={[7, 11, 6]}
        intensity={1.65}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-camera-left={-arenaSpan}
        shadow-camera-right={arenaSpan}
        shadow-camera-top={arenaSpan}
        shadow-camera-bottom={-arenaSpan}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-7, 5, -7]} intensity={0.5} />

      <SimulationArenaMesh
        arena={arena}
        collidedBarrierIds={collidedBarrierIds}
      />

      <SimulationRobotMesh
        robotConfig={world.getRobotConfig()}
        footprint={world.getRobotFootprint()}
        robotGroupRef={robotGroupRef}
        leftWheelRefs={leftWheelRefs}
        rightWheelRefs={rightWheelRefs}
        hasCollision={collidedBarrierIds.length > 0}
        assemblyParts={assemblyParts}
        connections={connections}
        drivetrain={drivetrain}
        selectedPartId={selectedPartId}
      />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={[...defaultCameraPose.target]}
        enableDamping
        dampingFactor={0.08}
        enablePan
        enableZoom
        enableRotate
        minDistance={defaultCameraPose.minDistance}
        maxDistance={defaultCameraPose.maxDistance}
        minPolarAngle={0.04}
        maxPolarAngle={Math.PI * 0.48}
      />

      <Environment preset="warehouse" />
    </>
  );
}
