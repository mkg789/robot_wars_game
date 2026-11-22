import { useLayoutEffect, useRef } from "react";
import { TransformControls, RoundedBox } from "@react-three/drei";
import type { Group } from "three";

import BatteryModel from "./BatteryModel";
import ControllerModel, {
  type ControllerVariant,
} from "./ControllerModel";
import MotorModel from "./MotorModel";
import { ChassisModel, TopPlateModel } from "./ChassisModel";
import WheelModel from "./WheelModel";
import { batteryCatalogue } from "../../features/robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../../features/robot-builder/data/controllerCatalogue";
import { wheelCatalogue } from "../../features/robot-builder/data/wheelCatalogue";
import type {
  RobotPart,
  TransformMode,
} from "../../features/robot-builder/types/robot.types";

type RobotObjectProps = {
  part: RobotPart;
  selected: boolean;
  transformMode: TransformMode;
  onSelect: () => void;
  onTransformUpdate: (
    position: [number, number, number],
    rotation: [number, number, number],
    size?: [number, number, number]
  ) => void;
  onTransformStart: () => void;
  onTransformEnd: () => void;
  onWheelTransformEnd?: (position: [number, number, number]) => void;
  attached: boolean;
  highlighted?: boolean;
};

export default function RobotObject({
  part,
  selected,
  transformMode,
  onSelect,
  onTransformUpdate,
  onTransformStart,
  onTransformEnd,
  onWheelTransformEnd,
  attached,
  highlighted = false,
}: RobotObjectProps) {
  const groupRef = useRef<Group>(null);
  const isTransformingRef = useRef(false);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group || isTransformingRef.current) return;

    group.position.set(...part.position);
    group.rotation.set(...(part.rotation ?? [0, 0, 0]));
    group.scale.set(1, 1, 1);
  }, [part.position, part.rotation, part.size]);

  const materialColor =
    selected || highlighted ? "#fbbf24" : part.color;
  const batteryDefinition = batteryCatalogue.find(
    (battery) => battery.id === part.batteryCatalogueId
  );
  const controllerDefinition = controllerCatalogue.find(
    (controller) => controller.id === part.controllerCatalogueId
  );
  const controllerLookup = `${part.controllerCatalogueId ?? ""} ${controllerDefinition?.name ?? ""}`.toLowerCase();
  const controllerVariant: ControllerVariant = controllerLookup.includes("esp")
    ? "esp32"
    : controllerLookup.includes("stm") || controllerLookup.includes("nucleo")
      ? "stm32-nucleo"
      : "arduino-uno";

  const batteryDesign =
    part.batteryCatalogueId === "standard-lipo"
      ? "hardcase-3s"
      : part.batteryCatalogueId === "heavy-duty-lipo"
        ? "drone-6s"
        : "soft-2s";
  const batteryTypeLabel =
    batteryDesign === "soft-2s"
      ? "SOFT POUCH"
      : batteryDesign === "hardcase-3s"
        ? "HARDCASE"
        : "DRONE PACK";

  const geometry = (() => {
    switch (part.type) {
      case "Armor Plate":
        return <boxGeometry args={part.size} />;

      case "Front Bumper":
        return (
          <RoundedBox
            args={part.size}
            radius={0.04}
            smoothness={3}
          />
        );

      case "Wheel":
        return null;

      case "Motor":
        return null;

      case "Structural Block":
      default:
        return <boxGeometry args={part.size} />;
    }
  })();

  const robotMesh = (
    <group
      ref={groupRef}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {part.id === "foundation-chassis" ? (
        <ChassisModel
          size={part.size}
          color={part.color}
          selected={selected || highlighted}
        />
      ) : part.id === "foundation-top-plate" ? (
        <TopPlateModel size={part.size} color={materialColor} />
      ) : part.type === "Motor" ? (
        <MotorModel
          size={part.size}
          housingColor={part.color}
          selected={selected || highlighted}
        />
      ) : part.type === "Battery" ? (
        <BatteryModel
          size={part.size}
          color={part.color}
          selected={selected || highlighted}
          design={batteryDesign}
          label="RW POWER"
          typeLabel={batteryTypeLabel}
          voltage={batteryDefinition?.voltage}
          capacityMah={batteryDefinition?.capacityMah}
        />
      ) : part.type === "Controller" ? (
        <ControllerModel
          size={part.size}
          color={controllerDefinition?.color ?? part.color}
          selected={selected || highlighted}
          variant={controllerVariant}
        />
      ) : part.type === "Wheel" ? (
        <WheelModel
          radius={part.size[0]}
          width={part.size[1]}
          color={materialColor}
          category={wheelCatalogue.find(
            (wheel) => wheel.id === part.wheelCatalogueId
          )?.category ?? "Rubber"}
        />
      ) : (
        <mesh
          rotation={[0, 0, 0]}
          castShadow
          receiveShadow
        >
          {geometry}
          <meshStandardMaterial
            color={materialColor}
            metalness={part.type === "Armor Plate" ? 0.8 : 0.55}
            roughness={part.type === "Armor Plate" ? 0.3 : 0.4}
          />
        </mesh>
      )}
    </group>
  );

  if (!selected || attached || transformMode === "select") {
    return robotMesh;
  }

  return (
    <TransformControls
      mode={transformMode}
      onMouseDown={() => {
        isTransformingRef.current = true;
        onTransformStart();
      }}
      onMouseUp={() => {
        const group = groupRef.current;

        if (!group) return;

        const releasedPosition: [number, number, number] = [
          group.position.x,
          group.position.y,
          group.position.z,
        ];
        const releasedRotation: [number, number, number] = [
          group.rotation.x,
          group.rotation.y,
          group.rotation.z,
        ];

        const scaledSize: [number, number, number] = [
          Math.max(0.01, part.size[0] * group.scale.x),
          Math.max(0.01, part.size[1] * group.scale.y),
          Math.max(0.01, part.size[2] * group.scale.z),
        ];

        onTransformUpdate(
          releasedPosition,
          releasedRotation,
          transformMode === "scale" ? scaledSize : undefined
        );

        if (part.type === "Wheel") {
          onWheelTransformEnd?.(releasedPosition);
        }

        group.scale.set(1, 1, 1);
        isTransformingRef.current = false;
        onTransformEnd();
      }}
    >
      {robotMesh}
    </TransformControls>
  );
}