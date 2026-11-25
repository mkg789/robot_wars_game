import type { RefObject } from "react";
import type { Group } from "three";
import { deriveRobotFootprintDimensions } from "../../features/simulation/logic/collisionModel";
import type { SimulationRobotConfig } from "../../features/simulation/types/simulation.types";

interface SimulationRobotMeshProps {
  readonly robotConfig: SimulationRobotConfig;
  readonly robotGroupRef: RefObject<Group | null>;
  readonly leftWheelRefs: RefObject<(Group | null)[]>;
  readonly rightWheelRefs: RefObject<(Group | null)[]>;
  readonly hasCollision: boolean;
}

/**
 * Simplified 3D robot representation derived strictly from SimulationRobotConfig
 * and the Phase 4.1.3 OBB collision footprint dimensions.
 *
 * Local frame: +X = forward, +Y = up, +Z = left.
 * Positioned and rotated imperatively by SimulationScene via refs.
 */
export default function SimulationRobotMesh({
  robotConfig,
  robotGroupRef,
  leftWheelRefs,
  rightWheelRefs,
  hasCollision,
}: SimulationRobotMeshProps) {
  const footprint = deriveRobotFootprintDimensions(robotConfig);
  const { lengthM, widthM } = footprint;

  const maxWheelRadius = Math.max(
    0.04,
    ...robotConfig.wheels.map((w) => w.radiusM)
  );
  const chassisHeight = Math.max(0.14, Math.min(0.32, maxWheelRadius * 1.4));
  const chassisBottomY = Math.max(0.03, maxWheelRadius * 0.45);
  const chassisCenterY = chassisBottomY + chassisHeight / 2;

  const chassisBodyLength = Math.max(0.2, lengthM * 0.88);
  const chassisBodyWidth = Math.max(0.2, robotConfig.trackWidthM * 0.86);

  const leftWheels = robotConfig.wheels.filter((w) => w.side === "left");
  const rightWheels = robotConfig.wheels.filter((w) => w.side === "right");

  const getWheelXOffset = (slotIndex: number, sideCount: number): number => {
    if (
      sideCount >= 2 &&
      robotConfig.wheelbaseM !== null &&
      robotConfig.wheelbaseM > 0
    ) {
      return slotIndex === 0
        ? robotConfig.wheelbaseM / 2
        : -robotConfig.wheelbaseM / 2;
    }
    return 0;
  };

  const outlineColor = hasCollision ? "#ef4444" : "#38bdf8";
  const outlineThickness = 0.02;

  return (
    <group ref={robotGroupRef}>
      {/* Main Chassis Body */}
      <mesh position={[0, chassisCenterY, 0]} castShadow receiveShadow>
        <boxGeometry args={[chassisBodyLength, chassisHeight, chassisBodyWidth]} />
        <meshStandardMaterial
          color={hasCollision ? "#472427" : "#313b49"}
          metalness={0.68}
          roughness={0.36}
        />
      </mesh>

      {/* Forward (+X) Heading Indicator Bar & Nose Chevron */}
      <mesh
        position={[
          chassisBodyLength / 2 - 0.04,
          chassisCenterY + chassisHeight / 2 + 0.015,
          0,
        ]}
        castShadow
      >
        <boxGeometry args={[0.1, 0.025, chassisBodyWidth * 0.65]} />
        <meshStandardMaterial
          color="#f59e0b"
          emissive="#b45309"
          emissiveIntensity={0.35}
          roughness={0.4}
        />
      </mesh>
      <mesh
        position={[chassisBodyLength / 2 + 0.025, chassisCenterY, 0]}
        castShadow
      >
        <boxGeometry args={[0.05, chassisHeight * 0.5, chassisBodyWidth * 0.45]} />
        <meshStandardMaterial color="#f59e0b" metalness={0.4} roughness={0.4} />
      </mesh>

      {/* Left Wheels (+Z side) */}
      {leftWheels.map((wheel, index) => {
        const wheelWidth = wheel.widthM ?? 0.06;
        const xOffset = getWheelXOffset(wheel.slotIndex, leftWheels.length);
        return (
          <group
            key={wheel.wheelId}
            position={[xOffset, wheel.radiusM, robotConfig.trackWidthM / 2]}
            ref={(el) => {
              if (leftWheelRefs.current) {
                leftWheelRefs.current[index] = el;
              }
            }}
          >
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry
                args={[wheel.radiusM, wheel.radiusM, wheelWidth, 24]}
              />
              <meshStandardMaterial
                color="#181c22"
                metalness={0.15}
                roughness={0.85}
              />
            </mesh>
            {/* Spoke marker so wheel rotation is visibly legible */}
            <mesh position={[wheel.radiusM * 0.45, 0, wheelWidth / 2 + 0.002]}>
              <boxGeometry args={[wheel.radiusM * 0.7, 0.02, 0.006]} />
              <meshStandardMaterial color="#94a3b8" />
            </mesh>
          </group>
        );
      })}

      {/* Right Wheels (-Z side) */}
      {rightWheels.map((wheel, index) => {
        const wheelWidth = wheel.widthM ?? 0.06;
        const xOffset = getWheelXOffset(wheel.slotIndex, rightWheels.length);
        return (
          <group
            key={wheel.wheelId}
            position={[xOffset, wheel.radiusM, -robotConfig.trackWidthM / 2]}
            ref={(el) => {
              if (rightWheelRefs.current) {
                rightWheelRefs.current[index] = el;
              }
            }}
          >
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry
                args={[wheel.radiusM, wheel.radiusM, wheelWidth, 24]}
              />
              <meshStandardMaterial
                color="#181c22"
                metalness={0.15}
                roughness={0.85}
              />
            </mesh>
            <mesh position={[wheel.radiusM * 0.45, 0, -(wheelWidth / 2 + 0.002)]}>
              <boxGeometry args={[wheel.radiusM * 0.7, 0.02, 0.006]} />
              <meshStandardMaterial color="#94a3b8" />
            </mesh>
          </group>
        );
      })}

      {/* Ground-Plane OBB Collision Footprint Outline (matches collisionModel envelope) */}
      <group position={[0, 0.01, 0]}>
        {/* Front (+X) & Rear (-X) edges */}
        <mesh position={[lengthM / 2, 0, 0]}>
          <boxGeometry args={[outlineThickness, 0.008, widthM]} />
          <meshBasicMaterial color={outlineColor} />
        </mesh>
        <mesh position={[-lengthM / 2, 0, 0]}>
          <boxGeometry args={[outlineThickness, 0.008, widthM]} />
          <meshBasicMaterial color={outlineColor} />
        </mesh>
        {/* Left (+Z) & Right (-Z) edges */}
        <mesh position={[0, 0, widthM / 2]}>
          <boxGeometry args={[lengthM, 0.008, outlineThickness]} />
          <meshBasicMaterial color={outlineColor} />
        </mesh>
        <mesh position={[0, 0, -widthM / 2]}>
          <boxGeometry args={[lengthM, 0.008, outlineThickness]} />
          <meshBasicMaterial color={outlineColor} />
        </mesh>
      </group>
    </group>
  );
}
