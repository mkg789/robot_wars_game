
import {
  ContactShadows,
  Grid,
  OrbitControls,
  Environment,
} from "@react-three/drei";
import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";

import RobotObject from "./RobotObject";

import type {
  RobotPart,
  TransformMode,
} from "../../features/robot-builder/types/robot.types";

import { useRobotStore } from "../../store/robotStore";
import {
  getMotorShaftMountPosition,
  type MountCandidate,
} from "../../features/robot-builder/logic/mounting";
import { generateMotorMountZones } from "../../features/robot-builder/logic/mountingZones";
import { motorCatalogue } from "../../features/robot-builder/data/motorCatalogue";
import { wheelCatalogue } from "../../features/robot-builder/data/wheelCatalogue";
import { getWheelWorldMountTransform } from "../../features/robot-builder/logic/wheelMounting";
import WheelModel from "./WheelModel";
import MotorModel from "./MotorModel";

type RobotSceneProps = {
  parts: RobotPart[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  transformMode: TransformMode;
  mountCandidate: MountCandidate | null;
  onMountCandidateChange: (candidate: MountCandidate | null) => void;
  cameraFocusRequest: {
    key: number;
    length: number;
    width: number;
    height: number;
  };
};

function CameraFocus({
  request,
}: {
  request: {
    key: number;
    length: number;
    width: number;
    height: number;
  };
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (request.key === 0) return;
    const distance = Math.max(5, Math.max(request.length, request.width) * 2 + 1.5);
    const targetY = request.height * 0.5;
    camera.position.set(
      distance * 0.68,
      targetY + distance * 0.66,
      distance * 0.92
    );
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();
  }, [camera, request]);

  return null;
}

export default function RobotScene({
  parts,
  selectedId,
  setSelectedId,
  transformMode,
  mountCandidate,
  onMountCandidateChange,
  cameraFocusRequest,
}: RobotSceneProps) {
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const updatePartTransform = useRobotStore(
    (state) => state.updatePartTransform
  );
  const connections = useRobotStore((state) => state.connections);
  const foundation = useRobotStore((state) => state.foundation);
  const stage = useRobotStore((state) => state.stage);
  const selectedMotorCatalogueId = useRobotStore(
    (state) => state.selectedMotorCatalogueId
  );
  const selectedMountZoneId = useRobotStore(
    (state) => state.selectedMountZoneId
  );
  const selectMountZone = useRobotStore((state) => state.selectMountZone);
  const selectedWheelCatalogueId = useRobotStore(
    (state) => state.selectedWheelCatalogueId
  );
  const selectedWheelMotorId = useRobotStore(
    (state) => state.selectedWheelMotorId
  );
  const selectWheelMotor = useRobotStore((state) => state.selectWheelMotor);

  const motorZones =
    stage === "motors" && foundation
      ? generateMotorMountZones(foundation)
      : [];
  const occupiedZoneIds = new Set(
    parts
      .filter((part) => part.type === "Motor" && part.mountingZoneId)
      .map((part) => part.mountingZoneId)
  );
  const previewMotor = motorCatalogue.find(
    (motor) => motor.id === selectedMotorCatalogueId
  );
  const previewWheel = wheelCatalogue.find(
    (wheel) => wheel.id === selectedWheelCatalogueId
  );
  const previewMotorPart = parts.find(
    (part) => part.id === selectedWheelMotorId && part.type === "Motor"
  );
  const previewWheelTransform =
    previewWheel && previewMotorPart
      ? getWheelWorldMountTransform(previewMotorPart, previewWheel)
      : null;
  const assignedPreviewMotorWheel = previewMotorPart
    ? parts.find(
        (part) =>
          part.type === "Wheel" &&
          connections.some(
            (connection) =>
              connection.type === "Motor-Wheel" &&
              connection.parentId === previewMotorPart.id &&
              connection.childId === part.id
          )
      )
    : undefined;
  const previewWheelIsCompatible = Boolean(
    previewWheel &&
    previewMotorPart?.motorCatalogueId &&
    previewWheel.compatibleMotorIds.includes(
      previewMotorPart.motorCatalogueId
    )
  );
  const wheelMotorIds = new Set(
    connections
      .filter((connection) => connection.type === "Motor-Wheel")
      .map((connection) => connection.parentId)
  );
  const targetY = foundation ? foundation.height * 0.5 : 0.5;
  const groundScale = Math.max(
    foundation?.length ?? 2,
    foundation?.width ?? 1.5
  );

  const handleWheelTransformEnd = (
    wheelId: string,
    position: [number, number, number]
  ) => {
    const existingConnection = connections.find(
      (connection) =>
        connection.type === "Motor-Wheel" &&
        (connection.childId ?? connection.targetId) === wheelId
    );

    const nearbyMotor = parts
      .filter((part) => part.type === "Motor")
      .map((motor) => {
        const mountPosition = getMotorShaftMountPosition(motor);
        const distance = Math.sqrt(
          (position[0] - mountPosition[0]) ** 2 +
          (position[1] - mountPosition[1]) ** 2 +
          (position[2] - mountPosition[2]) ** 2
        );
        return { motor, distance };
      })
      .filter(({ distance }) => distance <= 0.75)
      .sort((left, right) => left.distance - right.distance)[0];

    if (!nearbyMotor) return;
    if (
      (existingConnection?.parentId ??
        existingConnection?.sourceId) === nearbyMotor.motor.id
    ) return;

    onMountCandidateChange({
      motorId: nearbyMotor.motor.id,
      wheelId,
    });
  };

  return (
    <>
      <hemisphereLight
        args={["#dce7f1", "#26313c", 0.58]}
      />
      <ambientLight intensity={0.36} />

      <directionalLight
        position={[5, 8, 6]}
        intensity={1.65}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.00015}
      />
      <directionalLight position={[-5, 4, -4]} intensity={0.48} />

      {/* Robot Components */}
      {parts.map((part) => (
        <RobotObject
          key={part.id}
          part={part}
          selected={selectedId === part.id}
          highlighted={
            mountCandidate?.motorId === part.id ||
            mountCandidate?.wheelId === part.id ||
            (stage === "wheels" && selectedWheelMotorId === part.id)
          }
          attached={
            Boolean(
              part.parentAttachmentId ||
                connections.some(
                  (connection) =>
                    (connection.childId ?? connection.targetId) === part.id
                )
            )
          }
          transformMode={transformMode}
          onSelect={() => setSelectedId(part.id)}
          onTransformUpdate={(position, rotation, size) =>
            updatePartTransform(part.id, position, rotation, size)
          }
          onTransformStart={() => setOrbitEnabled(false)}
          onTransformEnd={() => setOrbitEnabled(true)}
          onWheelTransformEnd={(position) =>
            handleWheelTransformEnd(part.id, position)
          }
        />
      ))}

      {motorZones.map((zone) => {
        const occupied = occupiedZoneIds.has(zone.id);
        const selected = selectedMountZoneId === zone.id;
        return (
          <group
            key={zone.id}
            position={zone.position}
            rotation={zone.rotation}
            onClick={(event) => {
              event.stopPropagation();
              selectMountZone(zone.id);
            }}
          >
            <mesh>
              <cylinderGeometry
                args={[
                  selected ? 0.16 : 0.13,
                  selected ? 0.16 : 0.13,
                  0.025,
                  24,
                ]}
              />
              <meshStandardMaterial
                color={
                  occupied
                    ? "#58889b"
                    : selected
                      ? "#c79543"
                      : "#668b75"
                }
                emissive={
                  selected ? "#76501d" : occupied ? "#1f3a46" : "#26372d"
                }
                emissiveIntensity={selected ? 0.32 : 0.12}
                transparent
                opacity={0.82}
                roughness={0.48}
              />
            </mesh>
          </group>
        );
      })}

      {stage === "motors" &&
        previewMotor &&
        selectedMountZoneId &&
        !occupiedZoneIds.has(selectedMountZoneId) &&
        motorZones.find((zone) => zone.id === selectedMountZoneId) && (
          <group
            position={
              motorZones.find((zone) => zone.id === selectedMountZoneId)
                ?.position ?? [0, 0, 0]
            }
            rotation={
              motorZones.find((zone) => zone.id === selectedMountZoneId)
                ?.rotation ?? [0, 0, 0]
            }
          >
            <MotorModel
              size={previewMotor.dimensions}
              housingColor={previewMotor.color}
              preview
            />
          </group>
        )}

      {stage === "wheels" &&
        parts
          .filter((part) => part.type === "Motor")
          .map((motor) => (
            <mesh
              key={`wheel-mount:${motor.id}`}
              position={getMotorShaftMountPosition(motor)}
              onClick={(event) => {
                event.stopPropagation();
                selectWheelMotor(motor.id);
              }}
            >
              <sphereGeometry args={[0.09, 20, 20]} />
              <meshStandardMaterial
                color={
                  selectedWheelMotorId === motor.id
                    ? "#fbbf24"
                    : wheelMotorIds.has(motor.id)
                      ? "#22c55e"
                      : "#38bdf8"
                }
                emissive={
                  selectedWheelMotorId === motor.id
                    ? "#f59e0b"
                    : wheelMotorIds.has(motor.id)
                      ? "#14532d"
                      : "#0c4a6e"
                }
                emissiveIntensity={0.75}
              />
            </mesh>
          ))}

      {stage === "wheels" &&
        previewWheel &&
        previewWheelTransform && (
          (!assignedPreviewMotorWheel ||
            assignedPreviewMotorWheel.wheelCatalogueId !== previewWheel.id) &&
          previewWheelIsCompatible
        ) && (
          <group
            position={previewWheelTransform.position}
            rotation={previewWheelTransform.rotation}
          >
            <WheelModel
              radius={previewWheel.diameter / 2}
              width={previewWheel.width}
              color={previewWheel.color}
              preview
              category={previewWheel.category}
            />
          </group>
        )}

      <mesh
        position={[0, -0.025, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial
          color="#0b1118"
          metalness={0.08}
          roughness={0.9}
        />
      </mesh>
      <ContactShadows
        position={[0, -0.014, 0]}
        opacity={0.28}
        scale={groundScale * 3}
        blur={2.2}
        far={3}
        resolution={256}
      />

      <Grid
        position={[0, -0.008, 0]}
        args={[40, 40]}
        cellSize={1}
        cellThickness={0.45}
        cellColor="#34404d"
        sectionSize={4}
        sectionThickness={0.9}
        sectionColor="#536273"
        fadeDistance={28}
        fadeStrength={0.85}
        infiniteGrid
      />

      <CameraFocus request={cameraFocusRequest} />

      <OrbitControls
        makeDefault
        target={[0, targetY, 0]}
        enabled={orbitEnabled}
        enableDamping
        dampingFactor={0.075}
        minDistance={2.5}
        maxDistance={20}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI * 0.48}
        zoomSpeed={0.85}
      />

      <Environment preset="warehouse" />
    </>
  );
}
