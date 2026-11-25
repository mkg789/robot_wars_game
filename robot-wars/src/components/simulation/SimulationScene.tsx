import { Environment, OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three";
import type { SimulationWorld } from "../../features/simulation/logic/simulationWorld";
import type { ArenaConfig } from "../../features/simulation/types/arena.types";
import type { SimulationTelemetrySnapshot } from "../../features/simulation/types/simulationWorld.types";
import SimulationArenaMesh from "./SimulationArenaMesh";
import SimulationRobotMesh from "./SimulationRobotMesh";

interface SimulationSceneProps {
  readonly world: SimulationWorld;
  readonly arena: ArenaConfig;
  readonly collidedBarrierIds: readonly string[];
  readonly onTelemetryTick: (snapshot: SimulationTelemetrySnapshot) => void;
}

const TELEMETRY_SYNC_INTERVAL_SECONDS = 0.08;

/**
 * Three.js / React Three Fiber scene driving visual updates from SimulationWorld.
 *
 * Updates robot group position/rotation and wheel spin imperatively inside useFrame
 * so React state does not rerender on every physics step or render frame.
 */
export default function SimulationScene({
  world,
  arena,
  collidedBarrierIds,
  onTelemetryTick,
}: SimulationSceneProps) {
  const robotGroupRef = useRef<Group>(null);
  const leftWheelRefs = useRef<(Group | null)[]>([]);
  const rightWheelRefs = useRef<(Group | null)[]>([]);
  const telemetryAccumulatorRef = useRef(0);
  const lastCollisionKeyRef = useRef("");

  const syncVisualPose = (deltaSeconds: number) => {
    const pose = world.getRenderPose();
    const group = robotGroupRef.current;
    if (group) {
      group.position.set(pose.xMeters, 0, pose.zMeters);
      // In Three.js right-handed space, rotation.y = -headingRadians rotates +X toward +Z
      group.rotation.set(0, -pose.headingRadians, 0);
    }

    if (deltaSeconds > 0) {
      for (const wheel of leftWheelRefs.current) {
        if (wheel) {
          wheel.rotation.z -= pose.leftWheelAngularVelocityRadPerSec * deltaSeconds;
        }
      }
      for (const wheel of rightWheelRefs.current) {
        if (wheel) {
          wheel.rotation.z -= pose.rightWheelAngularVelocityRadPerSec * deltaSeconds;
        }
      }
    }
  };

  useEffect(() => {
    syncVisualPose(0);
    // Sync immediately on reset/arena change
    const snapshot = world.getTelemetrySnapshot();
    lastCollisionKeyRef.current = snapshot.collision.collidedBarrierIds.join("|");
    onTelemetryTick(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, arena]);

  useFrame((_, delta) => {
    const status = world.getLifecycleStatus();
    if (status === "running") {
      world.stepFrame(delta);
    }

    syncVisualPose(status === "running" ? delta : 0);

    const collision = world.getCollisionIndicator();
    const collisionKey = collision.collidedBarrierIds.join("|");
    const collisionChanged = collisionKey !== lastCollisionKeyRef.current;

    telemetryAccumulatorRef.current += delta;
    if (
      collisionChanged ||
      (status === "running" &&
        telemetryAccumulatorRef.current >= TELEMETRY_SYNC_INTERVAL_SECONDS)
    ) {
      telemetryAccumulatorRef.current = 0;
      lastCollisionKeyRef.current = collisionKey;
      onTelemetryTick(world.getTelemetrySnapshot());
    }
  });

  const arenaSpan = Math.max(arena.dimensions.lengthM, arena.dimensions.widthM);
  const centerX = (arena.bounds.minX + arena.bounds.maxX) / 2;
  const centerZ = (arena.bounds.minZ + arena.bounds.maxZ) / 2;

  return (
    <>
      <hemisphereLight args={["#dce7f1", "#202b38", 0.65]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[8, 12, 8]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-camera-left={-arenaSpan}
        shadow-camera-right={arenaSpan}
        shadow-camera-top={arenaSpan}
        shadow-camera-bottom={-arenaSpan}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-6, 6, -6]} intensity={0.42} />

      <SimulationArenaMesh
        arena={arena}
        collidedBarrierIds={collidedBarrierIds}
      />

      <SimulationRobotMesh
        robotConfig={world.getRobotConfig()}
        robotGroupRef={robotGroupRef}
        leftWheelRefs={leftWheelRefs}
        rightWheelRefs={rightWheelRefs}
        hasCollision={collidedBarrierIds.length > 0}
      />

      <OrbitControls
        makeDefault
        target={[centerX, 0.25, centerZ]}
        enableDamping
        dampingFactor={0.08}
        minDistance={2.5}
        maxDistance={arenaSpan * 2.5}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI * 0.46}
      />

      <Environment preset="warehouse" />
    </>
  );
}
