import { useMemo } from "react";
import { getOrCreateThreeBufferGeometry } from "../../features/robot-builder/logic/meshAssetRegistry";
import { generateMountingPatternPoints } from "../../features/robot-builder/logic/mountingPatterns";
import { STL_UNIT_TO_METERS } from "../../features/robot-builder/logic/stlParser";
import type {
  AttachmentInterface,
  CustomCollisionConfig,
  ImportedMeshTransform,
  MountingPatternConfig,
} from "../../features/robot-builder/types/robot.types";

interface CustomMeshModelProps {
  readonly assetId: string;
  readonly meshTransform?: ImportedMeshTransform;
  readonly color?: string;
  readonly selected?: boolean;
  readonly preview?: boolean;
  readonly collisionConfig?: CustomCollisionConfig;
  readonly showCollisionOverlay?: boolean;
  readonly customInterfaces?: readonly AttachmentInterface[];
  readonly mountingPatterns?: readonly MountingPatternConfig[];
}

export function MountingPatternOverlay({
  patterns,
  yOffset = 0.004,
}: {
  readonly patterns?: readonly MountingPatternConfig[];
  readonly yOffset?: number;
}) {
  const markers = useMemo(() => {
    if (!patterns || patterns.length === 0) return [];
    return patterns.flatMap((pattern) =>
      generateMountingPatternPoints(pattern).points.map((pt) => ({
        id: pt.id,
        position: [pt.position[0], pt.position[1] + yOffset, pt.position[2]] as const,
        diameter: Math.max(0.008, pattern.holeDiameterM),
      }))
    );
  }, [patterns, yOffset]);

  if (markers.length === 0) return null;

  return (
    <group>
      {markers.map((marker) => (
        <mesh key={marker.id} position={[marker.position[0], marker.position[1], marker.position[2]]}>
          <cylinderGeometry args={[marker.diameter * 0.5, marker.diameter * 0.5, 0.003, 10]} />
          <meshStandardMaterial color="#0f172a" metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

export default function CustomMeshModel({
  assetId,
  meshTransform,
  color = "#64748b",
  selected = false,
  preview = false,
  collisionConfig,
  showCollisionOverlay = false,
  customInterfaces,
  mountingPatterns,
}: CustomMeshModelProps) {
  // Registry memoizes the singleton BufferGeometry per assetId; direct lookup avoids
  // holding stale references if an asset record is restored under the same id.
  const geometry = getOrCreateThreeBufferGeometry(assetId);

  const unitFactor = meshTransform ? STL_UNIT_TO_METERS[meshTransform.unit] : 0.001;
  const scaleTuple: [number, number, number] = meshTransform
    ? meshTransform.scaleMode === "uniform"
      ? [
          unitFactor * meshTransform.uniformScale,
          unitFactor * meshTransform.uniformScale,
          unitFactor * meshTransform.uniformScale,
        ]
      : [
          unitFactor * meshTransform.nonUniformScale[0],
          unitFactor * meshTransform.nonUniformScale[1],
          unitFactor * meshTransform.nonUniformScale[2],
        ]
    : [unitFactor, unitFactor, unitFactor];

  if (!geometry) {
    return (
      <mesh>
        <boxGeometry args={[0.4, 0.2, 0.4]} />
        <meshStandardMaterial color="#ef4444" wireframe />
      </mesh>
    );
  }

  return (
    <group>
      <mesh scale={scaleTuple} castShadow receiveShadow>
        {/* Opt shared registry BufferGeometry out of R3F unmount disposal while keeping instance material disposable */}
        <primitive object={geometry} attach="geometry" dispose={null} />
        <meshStandardMaterial
          color={selected ? "#f59e0b" : color}
          metalness={0.62}
          roughness={0.36}
          transparent={preview}
          opacity={preview ? 0.5 : 1}
          emissive={selected ? "#754b1b" : "#000000"}
          emissiveIntensity={selected ? 0.16 : 0}
        />
      </mesh>

      {showCollisionOverlay &&
        collisionConfig?.boxes.map((box) => (
          <mesh
            key={box.id}
            position={[box.center[0], box.center[1], box.center[2]]}
          >
            <boxGeometry args={[box.size[0], box.size[1], box.size[2]]} />
            <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.55} />
          </mesh>
        ))}

      {customInterfaces?.map((iface) => (
        <mesh
          key={iface.id}
          position={[iface.position[0], iface.position[1], iface.position[2]]}
        >
          <sphereGeometry args={[0.025, 12, 12]} />
          <meshStandardMaterial
            color={
              iface.interfaceCategory === "motor-mount"
                ? "#f97316"
                : iface.interfaceCategory === "wheel-mount"
                  ? "#22c55e"
                  : "#38bdf8"
            }
          />
        </mesh>
      ))}

      <MountingPatternOverlay patterns={mountingPatterns} />
    </group>
  );
}
