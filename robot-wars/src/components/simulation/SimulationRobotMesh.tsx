import { memo, useMemo, type RefObject } from "react";
import { RoundedBox } from "@react-three/drei";
import type { Group } from "three";
import type {
  DrivetrainConfiguration,
  RobotConnection,
  RobotPart,
} from "../../features/robot-builder/types/robot.types";
import { deriveRobotFootprintDimensions } from "../../features/simulation/logic/collisionModel";
import {
  resolveAssemblySimulationVisualSpec,
  resolveCollisionVisualState,
  type ResolvedAssemblyVisualPart,
} from "../../features/simulation/logic/simulationAssembly";
import type { SimulationRobotConfig } from "../../features/simulation/types/simulation.types";
import BatteryModel from "../viewport/BatteryModel";
import { ChassisModel, TopPlateModel } from "../viewport/ChassisModel";
import ControllerModel from "../viewport/ControllerModel";
import MotorModel from "../viewport/MotorModel";
import StructuralModel from "../viewport/StructuralModel";
import WheelModel from "../viewport/WheelModel";

interface SimulationRobotMeshProps {
  readonly robotConfig: SimulationRobotConfig;
  readonly robotGroupRef: RefObject<Group | null>;
  readonly leftWheelRefs: RefObject<(Group | null)[]>;
  readonly rightWheelRefs: RefObject<(Group | null)[]>;
  readonly hasCollision: boolean;
  readonly assemblyParts?: readonly RobotPart[];
  readonly connections?: readonly RobotConnection[];
  readonly drivetrain?: DrivetrainConfiguration | null;
  readonly footprint?: { readonly lengthM: number; readonly widthM: number };
  readonly selectedPartId?: string | null;
}

function renderNonWheelAssemblyPart(
  part: ResolvedAssemblyVisualPart,
  isSelected: boolean
) {
  const boxExtents: [number, number, number] = [
    part.boxExtents[0],
    part.boxExtents[1],
    part.boxExtents[2],
  ];

  switch (part.kind) {
    case "chassis":
      return (
        <ChassisModel
          size={boxExtents}
          color={part.color}
          selected={isSelected}
        />
      );
    case "top-plate":
      return (
        <TopPlateModel
          size={boxExtents}
          color={part.color}
          selected={isSelected}
        />
      );
    case "motor":
      return (
        <MotorModel
          size={boxExtents}
          housingColor={part.color}
          selected={isSelected}
        />
      );
    case "battery":
      return (
        <BatteryModel
          size={boxExtents}
          color={part.color}
          selected={isSelected}
          design={part.batteryMeta?.design}
          label="RW POWER"
          typeLabel={part.batteryMeta?.typeLabel}
          voltage={part.batteryMeta?.voltage}
          capacityMah={part.batteryMeta?.capacityMah}
        />
      );
    case "controller":
      return (
        <ControllerModel
          size={boxExtents}
          color={part.controllerMeta?.color ?? part.color}
          selected={isSelected}
          variant={part.controllerMeta?.variant}
        />
      );
    case "bumper":
    case "structural":
    default:
      if (part.structuralVisualShape) {
        return (
          <StructuralModel
            size={boxExtents}
            shape={part.structuralVisualShape}
            color={part.color}
            selected={isSelected}
          />
        );
      }
      if (part.geometryShape === "cylinder") {
        const cylRot: [number, number, number] =
          part.cylinderAxis === "x"
            ? [0, 0, Math.PI / 2]
            : part.cylinderAxis === "z"
              ? [Math.PI / 2, 0, 0]
              : [0, 0, 0];
        const r = Math.min(boxExtents[0], boxExtents[2]) * 0.5;
        const h =
          part.cylinderAxis === "x"
            ? boxExtents[0]
            : part.cylinderAxis === "z"
              ? boxExtents[2]
              : boxExtents[1];
        return (
          <mesh rotation={cylRot} castShadow receiveShadow>
            <cylinderGeometry args={[r, r, h, 28]} />
            <meshStandardMaterial
              color={part.color}
              metalness={0.55}
              roughness={0.38}
              emissive={isSelected ? "#0284c7" : "#000000"}
              emissiveIntensity={isSelected ? 0.25 : 0}
            />
          </mesh>
        );
      }
      if (part.kind === "bumper") {
        return (
          <RoundedBox
            args={boxExtents}
            radius={Math.min(0.04, Math.min(...boxExtents) * 0.3)}
            smoothness={3}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={part.color}
              metalness={0.45}
              roughness={0.38}
              emissive={isSelected ? "#0284c7" : "#000000"}
              emissiveIntensity={isSelected ? 0.25 : 0}
            />
          </RoundedBox>
        );
      }
      return (
        <mesh castShadow receiveShadow>
          <boxGeometry args={boxExtents} />
          <meshStandardMaterial
            color={part.color}
            metalness={0.45}
            roughness={0.42}
            emissive={isSelected ? "#0284c7" : "#000000"}
            emissiveIntensity={isSelected ? 0.25 : 0}
          />
        </mesh>
      );
  }
}

function SimulationRobotMesh({
  robotConfig,
  robotGroupRef,
  leftWheelRefs,
  rightWheelRefs,
  hasCollision,
  assemblyParts,
  connections,
  drivetrain,
  footprint,
  selectedPartId = null,
}: SimulationRobotMeshProps) {
  const effectiveFootprint = useMemo(
    () => footprint ?? deriveRobotFootprintDimensions(robotConfig),
    [footprint, robotConfig]
  );

  const collisionVisual = useMemo(
    () => resolveCollisionVisualState(hasCollision),
    [hasCollision]
  );

  const visualSpec = useMemo(
    () =>
      assemblyParts && assemblyParts.length > 0
        ? resolveAssemblySimulationVisualSpec({
            parts: assemblyParts,
            connections,
            drivetrain,
          })
        : null,
    [assemblyParts, connections, drivetrain]
  );

  const leftWheelIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    visualSpec?.leftWheelPartIds.forEach((id, idx) => map.set(id, idx));
    return map;
  }, [visualSpec]);

  const rightWheelIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    visualSpec?.rightWheelPartIds.forEach((id, idx) => map.set(id, idx));
    return map;
  }, [visualSpec]);

  const { lengthM, widthM } = effectiveFootprint;
  const primaryWheel = robotConfig.wheels[0];
  const wheelRadius = primaryWheel?.radiusM ?? 0.11;
  const wheelWidth = primaryWheel?.widthM ?? 0.06;
  const wheelBase = robotConfig.wheelbaseM ?? 0.4;
  const trackWidth = robotConfig.trackWidthM;

  const isFourWheel = robotConfig.drivetrain.type === "differential-4";
  const wheelXOffsets = isFourWheel ? [wheelBase / 2, -wheelBase / 2] : [0];
  const leftWheelZ = trackWidth / 2;
  const rightWheelZ = -trackWidth / 2;

  const topDeckY = useMemo(() => {
    if (!visualSpec || visualSpec.parts.length === 0) {
      return Math.max(0.16, wheelRadius * 1.4) + 0.04;
    }
    let maxY = 0.2;
    for (const part of visualSpec.parts) {
      const top =
        part.position[1] +
        visualSpec.verticalOffsetY +
        (part.kind === "wheel"
          ? part.cylinderDimensions.radius
          : part.boxExtents[1] * 0.5);
      if (top > maxY) {
        maxY = top;
      }
    }
    return maxY;
  }, [visualSpec, wheelRadius]);

  const neutralOutlineThickness = 0.012;
  const collisionOutlineThickness = 0.028;

  const chassisBodyLength = Math.max(0.24, lengthM - 0.06);
  const chassisBodyWidth = Math.max(0.2, trackWidth - wheelWidth - 0.04);
  const chassisHeight = Math.max(0.14, wheelRadius * 1.35);
  const chassisCenterY = chassisHeight * 0.5 + wheelRadius * 0.25;

  return (
    <group ref={robotGroupRef}>
      {visualSpec && visualSpec.parts.length > 0 ? (
        <group position={[0, visualSpec.verticalOffsetY, 0]}>
          {visualSpec.parts.map((part) => {
            const isSelected = selectedPartId === part.partId;
            if (part.kind === "wheel") {
              const leftIdx = leftWheelIndexMap.get(part.partId);
              const rightIdx = rightWheelIndexMap.get(part.partId);
              const d = part.cylinderDimensions.diameter;
              const w = part.cylinderDimensions.width;

              return (
                <group
                  key={part.partId}
                  position={[
                    part.position[0],
                    part.position[1],
                    part.position[2],
                  ]}
                  rotation={[
                    part.rotation[0],
                    part.rotation[1],
                    part.rotation[2],
                  ]}
                >
                  <group
                    ref={(el) => {
                      if (el) {
                        el.userData.axleSpinSign = part.axleSpinSign;
                      }
                      if (leftIdx !== undefined && leftWheelRefs.current) {
                        leftWheelRefs.current[leftIdx] = el;
                      } else if (
                        rightIdx !== undefined &&
                        rightWheelRefs.current
                      ) {
                        rightWheelRefs.current[rightIdx] = el;
                      }
                    }}
                  >
                    <WheelModel
                      radius={part.cylinderDimensions.radius}
                      width={part.cylinderDimensions.width}
                      color={part.color}
                      selected={isSelected}
                      category={part.wheelCategory}
                    />
                  </group>

                  {isSelected && (
                    <mesh>
                      <boxGeometry args={[w + 0.03, d + 0.03, d + 0.03]} />
                      <meshBasicMaterial
                        color={collisionVisual.inspectionHighlightColor}
                        wireframe
                        transparent
                        opacity={0.9}
                      />
                    </mesh>
                  )}
                </group>
              );
            }

            return (
              <group
                key={part.partId}
                position={[
                  part.position[0],
                  part.position[1],
                  part.position[2],
                ]}
                rotation={[
                  part.rotation[0],
                  part.rotation[1],
                  part.rotation[2],
                ]}
              >
                {renderNonWheelAssemblyPart(part, isSelected)}
                {isSelected && (
                  <mesh>
                    <boxGeometry
                      args={[
                        part.boxExtents[0] + 0.03,
                        part.boxExtents[1] + 0.03,
                        part.boxExtents[2] + 0.03,
                      ]}
                    />
                    <meshBasicMaterial
                      color={collisionVisual.inspectionHighlightColor}
                      wireframe
                      transparent
                      opacity={0.9}
                    />
                  </mesh>
                )}
              </group>
            );
          })}
        </group>
      ) : (
        <>
          {/* Fallback generic geometry when raw SimulationRobotConfig is rendered directly */}
          <mesh position={[0, chassisCenterY, 0]} castShadow receiveShadow>
            <boxGeometry
              args={[chassisBodyLength, chassisHeight, chassisBodyWidth]}
            />
            <meshStandardMaterial
              color="#313b49"
              metalness={0.68}
              roughness={0.36}
            />
          </mesh>

          {wheelXOffsets.map((xPos, index) => (
            <group
              key={`fallback-left-${xPos}`}
              position={[xPos, wheelRadius, leftWheelZ]}
              rotation={[0, -Math.PI / 2, 0]}
            >
              <group
                ref={(el) => {
                  if (el) el.userData.axleSpinSign = -1;
                  if (leftWheelRefs.current) {
                    leftWheelRefs.current[index] = el;
                  }
                }}
              >
                <WheelModel
                  radius={wheelRadius}
                  width={wheelWidth}
                  color="#181c22"
                  category="Rubber"
                />
              </group>
            </group>
          ))}

          {wheelXOffsets.map((xPos, index) => (
            <group
              key={`fallback-right-${xPos}`}
              position={[xPos, wheelRadius, rightWheelZ]}
              rotation={[0, Math.PI / 2, 0]}
            >
              <group
                ref={(el) => {
                  if (el) el.userData.axleSpinSign = 1;
                  if (rightWheelRefs.current) {
                    rightWheelRefs.current[index] = el;
                  }
                }}
              >
                <WheelModel
                  radius={wheelRadius}
                  width={wheelWidth}
                  color="#181c22"
                  category="Rubber"
                />
              </group>
            </group>
          ))}
        </>
      )}

      {/* Subtle Forward (+X) Heading Marker on Upper Deck */}
      <mesh position={[lengthM * 0.34, topDeckY + 0.022, 0]} castShadow>
        <boxGeometry args={[Math.min(0.14, lengthM * 0.14), 0.015, 0.08]} />
        <meshStandardMaterial
          color="#cbd5e1"
          emissive="#0284c7"
          emissiveIntensity={0.25}
          roughness={0.35}
          metalness={0.5}
        />
      </mesh>

      {/* Neutral Ground-Plane Robot Footprint Indicator (separate from collision state) */}
      {collisionVisual.showFootprintOutline && (
        <group position={[0, 0.008, 0]}>
          <mesh position={[lengthM / 2, 0, 0]}>
            <boxGeometry args={[neutralOutlineThickness, 0.004, widthM]} />
            <meshBasicMaterial
              color={collisionVisual.footprintOutlineColor}
              transparent
              opacity={collisionVisual.footprintOutlineOpacity}
            />
          </mesh>
          <mesh position={[-lengthM / 2, 0, 0]}>
            <boxGeometry args={[neutralOutlineThickness, 0.004, widthM]} />
            <meshBasicMaterial
              color={collisionVisual.footprintOutlineColor}
              transparent
              opacity={collisionVisual.footprintOutlineOpacity}
            />
          </mesh>
          <mesh position={[0, 0, widthM / 2]}>
            <boxGeometry args={[lengthM, 0.004, neutralOutlineThickness]} />
            <meshBasicMaterial
              color={collisionVisual.footprintOutlineColor}
              transparent
              opacity={collisionVisual.footprintOutlineOpacity}
            />
          </mesh>
          <mesh position={[0, 0, -widthM / 2]}>
            <boxGeometry args={[lengthM, 0.004, neutralOutlineThickness]} />
            <meshBasicMaterial
              color={collisionVisual.footprintOutlineColor}
              transparent
              opacity={collisionVisual.footprintOutlineOpacity}
            />
          </mesh>
        </group>
      )}

      {/* Active Collision Alert Indicator (rendered strictly while colliding) */}
      {collisionVisual.showCollisionHighlight && (
        <group position={[0, 0.016, 0]}>
          <mesh position={[(lengthM + 0.08) / 2, 0, 0]}>
            <boxGeometry
              args={[collisionOutlineThickness, 0.01, widthM + 0.08]}
            />
            <meshBasicMaterial
              color={collisionVisual.collisionHighlightColor}
            />
          </mesh>
          <mesh position={[-(lengthM + 0.08) / 2, 0, 0]}>
            <boxGeometry
              args={[collisionOutlineThickness, 0.01, widthM + 0.08]}
            />
            <meshBasicMaterial
              color={collisionVisual.collisionHighlightColor}
            />
          </mesh>
          <mesh position={[0, 0, (widthM + 0.08) / 2]}>
            <boxGeometry
              args={[lengthM + 0.08, 0.01, collisionOutlineThickness]}
            />
            <meshBasicMaterial
              color={collisionVisual.collisionHighlightColor}
            />
          </mesh>
          <mesh position={[0, 0, -(widthM + 0.08) / 2]}>
            <boxGeometry
              args={[lengthM + 0.08, 0.01, collisionOutlineThickness]}
            />
            <meshBasicMaterial
              color={collisionVisual.collisionHighlightColor}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}

export default memo(SimulationRobotMesh);
