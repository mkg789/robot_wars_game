
import { RoundedBox } from "@react-three/drei";
import { CatmullRomCurve3, Vector3 } from "three";

type MotorModelProps = {
  size: [number, number, number];
  housingColor: string;
  preview?: boolean;
  selected?: boolean;
};

export default function MotorModel({
  size,
  housingColor,
  preview = false,
  selected = false,
}: MotorModelProps) {
  const [length, height, width] = size;

  const radius = Math.min(height, width);
  const opacity = preview ? 0.48 : 1;

  const motorRadius = radius * 0.34;
  const gearboxRadius = radius * 0.43;
  const shaftRadius = radius * 0.105;

  const motorLength = length * 0.43;
  const gearboxLength = length * 0.37;
  const shaftLength = length * 0.48;

  const metallic = "#b9c2ca";
  const darkMetal = "#78838c";
  const yellow = housingColor || "#e6d28c";

  const materialProps = {
    transparent: preview,
    opacity,
  };

  // All motor components are arranged along the X axis.
  // The output shaft points in the positive X direction.

  const wires = [
    {
      color: "#c92727",
      points: [
        [-length * 0.39, radius * 0.10, 0],
        [-length * 0.49, radius * 0.24, 0],
        [-length * 0.54, radius * 0.42, 0],
        [-length * 0.61, radius * 0.49, 0],
      ],
    },
    {
      color: "#252525",
      points: [
        [-length * 0.39, -radius * 0.10, 0],
        [-length * 0.48, -radius * 0.20, 0],
        [-length * 0.55, -radius * 0.38, 0],
        [-length * 0.62, -radius * 0.43, 0],
      ],
    },
  ];

  return (
    <group>
      {/* 1. Silver DC motor can */}
      <mesh
        position={[-length * 0.19, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry
          args={[motorRadius, motorRadius, motorLength, 40]}
        />
        <meshStandardMaterial
          color={metallic}
          metalness={0.82}
          roughness={0.32}
          emissive={selected ? "#51401d" : "#000000"}
          emissiveIntensity={selected ? 0.12 : 0}
          {...materialProps}
        />
      </mesh>

      {/* Rear motor cap */}
      <mesh
        position={[-length * 0.405, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry
          args={[motorRadius * 0.91, motorRadius * 0.91, length * 0.035, 32]}
        />
        <meshStandardMaterial
          color="#929ca5"
          metalness={0.78}
          roughness={0.4}
          {...materialProps}
        />
      </mesh>

      {/* Motor can end details */}
      <mesh
        position={[length * 0.015, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry
          args={[motorRadius * 0.98, motorRadius * 0.98, length * 0.035, 32]}
        />
        <meshStandardMaterial
          color={darkMetal}
          metalness={0.82}
          roughness={0.3}
          {...materialProps}
        />
      </mesh>

      {/* 2. Yellow cylindrical gearbox */}
      <mesh
        position={[length * 0.18, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry
          args={[gearboxRadius, gearboxRadius, gearboxLength, 48]}
        />
        <meshStandardMaterial
          color={yellow}
          metalness={0.12}
          roughness={0.58}
          {...materialProps}
        />
      </mesh>

      {/* Gearbox rear collar */}
      <mesh
        position={[length * 0.005, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry
          args={[gearboxRadius * 0.96, gearboxRadius * 0.96, length * 0.035, 40]}
        />
        <meshStandardMaterial
          color="#d6c58b"
          roughness={0.52}
          {...materialProps}
        />
      </mesh>

      {/* 3. Raised gearbox front flange */}
      <mesh
        position={[length * 0.365, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry
          args={[gearboxRadius * 1.04, gearboxRadius * 1.04, length * 0.075, 48]}
        />
        <meshStandardMaterial
          color="#e5d6a5"
          roughness={0.48}
          {...materialProps}
        />
      </mesh>

      {/* Front flange rim */}
      <mesh
        position={[length * 0.405, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <torusGeometry
          args={[gearboxRadius * 0.89, radius * 0.025, 8, 40]}
        />
        <meshStandardMaterial
          color="#c6b780"
          roughness={0.45}
          {...materialProps}
        />
      </mesh>

      {/* 4. Metallic output bearing */}
      <mesh
        position={[length * 0.425, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry
          args={[shaftRadius * 2.1, shaftRadius * 2.1, length * 0.075, 32]}
        />
        <meshStandardMaterial
          color="#9da7af"
          metalness={0.9}
          roughness={0.25}
          {...materialProps}
        />
      </mesh>

      {/* Hexagonal metal shaft nut */}
      <mesh
        position={[length * 0.465, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry
          args={[
            shaftRadius * 3.5,
            shaftRadius * 3.5,
            length * 0.075,
            6,
          ]}
        />
        <meshStandardMaterial
          color="#aeb7be"
          metalness={0.92}
          roughness={0.28}
          {...materialProps}
        />
      </mesh>

      {/* Inner shaft bearing ring */}
      <mesh
        position={[length * 0.505, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry
          args={[
            shaftRadius * 1.65,
            shaftRadius * 1.65,
            length * 0.025,
            32,
          ]}
        />
        <meshStandardMaterial
          color="#737e87"
          metalness={0.95}
          roughness={0.2}
          {...materialProps}
        />
      </mesh>

      {/* 5. Steel output shaft */}
      <mesh
        position={[
          length * 0.505 + shaftLength * 0.5,
          0,
          0,
        ]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry
          args={[shaftRadius, shaftRadius, shaftLength, 32]}
        />
        <meshStandardMaterial
          color="#dce3e8"
          metalness={0.96}
          roughness={0.18}
          {...materialProps}
        />
      </mesh>

      {/* Shaft tip */}
      <mesh
        position={[
          length * 0.505 + shaftLength,
          0,
          0,
        ]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry
          args={[shaftRadius * 0.98, shaftRadius, length * 0.035, 32]}
        />
        <meshStandardMaterial
          color="#e0e5e9"
          metalness={0.96}
          roughness={0.16}
          {...materialProps}
        />
      </mesh>

      {/* 6. Yellow gearbox mounting screws */}
      {[-1, 1].flatMap((y) =>
        [-1, 1].map((z) => (
          <mesh
            key={`gear-screw-${y}-${z}`}
            position={[
              length * 0.407,
              y * gearboxRadius * 0.68,
              z * gearboxRadius * 0.68,
            ]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry
              args={[radius * 0.045, radius * 0.045, 0.018, 12]}
            />
            <meshStandardMaterial
              color="#727b82"
              metalness={0.9}
              roughness={0.28}
              {...materialProps}
            />
          </mesh>
        ))
      )}

      {/* 7. Small motor housing ventilation details */}
      {[-1, 1].map((side) => (
        <RoundedBox
          key={`vent-${side}`}
          args={[motorLength * 0.45, radius * 0.025, radius * 0.018]}
          position={[
            -length * 0.20,
            side * motorRadius * 0.99,
            0,
          ]}
          radius={0.005}
          smoothness={2}
        >
          <meshStandardMaterial
            color="#69747d"
            metalness={0.7}
            roughness={0.4}
            {...materialProps}
          />
        </RoundedBox>
      ))}

      {/* 8. Red and black electrical wires */}
      {wires.map((wire, index) => {
        const curve = new CatmullRomCurve3(
          wire.points.map(
            ([x, y, z]) => new Vector3(x, y, z)
          )
        );

        return (
          <mesh key={`wire-${index}`} castShadow>
            <tubeGeometry args={[curve, 24, radius * 0.025, 8, false]} />
            <meshStandardMaterial
              color={wire.color}
              roughness={0.65}
              {...materialProps}
            />
          </mesh>
        );
      })}
    </group>
  );
}
