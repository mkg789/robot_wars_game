import { RoundedBox } from "@react-three/drei";

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
  const opacity = preview ? 0.48 : 1;
  const bodyRadius = Math.min(height, width) * 0.38;
  const shaftRadius = Math.min(height, width) * 0.105;
  const shaftLength = length * 0.55;
  const plateThickness = Math.max(0.018, Math.min(height * 0.09, 0.04));
  const boltRadius = Math.min(0.025, height * 0.075, width * 0.07);

  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[bodyRadius, bodyRadius, length * 0.62, 32]} />
        <meshStandardMaterial
          color={housingColor}
          metalness={0.56}
          roughness={0.38}
          emissive={selected ? "#6b4218" : "#000000"}
          emissiveIntensity={selected ? 0.12 : 0}
          transparent={preview}
          opacity={opacity}
        />
      </mesh>

      {[ -0.23, -0.11, 0.11, 0.23 ].map((fraction) => (
        <mesh
          key={fraction}
          position={[fraction * length, 0, 0]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <torusGeometry args={[bodyRadius * 0.96, bodyRadius * 0.035, 6, 24]} />
          <meshStandardMaterial
            color={selected && fraction === 0.11 ? "#d0a15b" : "#aeb8c2"}
            metalness={0.78}
            roughness={0.32}
            transparent={preview}
            opacity={opacity}
          />
        </mesh>
      ))}

      <RoundedBox
        args={[length * 0.42, height * 0.9, width * 0.92]}
        position={[length * 0.22, 0, 0]}
        radius={Math.min(0.045, height * 0.12, width * 0.1)}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#64717d"
          metalness={0.76}
          roughness={0.31}
          transparent={preview}
          opacity={opacity}
        />
      </RoundedBox>

      <RoundedBox
        args={[length * 0.075, height * 0.72, width * 0.74]}
        position={[length * 0.46, 0, 0]}
        radius={Math.min(0.025, height * 0.08, width * 0.08)}
        smoothness={2}
        castShadow
      >
        <meshStandardMaterial
          color="#a8b2bc"
          metalness={0.82}
          roughness={0.28}
          transparent={preview}
          opacity={opacity}
        />
      </RoundedBox>

      <mesh
        position={[length * 0.53, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry
          args={[shaftRadius * 1.65, shaftRadius * 1.65, length * 0.075, 24]}
        />
        <meshStandardMaterial
          color="#7b8793"
          metalness={0.86}
          roughness={0.26}
          transparent={preview}
          opacity={opacity}
        />
      </mesh>

      <mesh
        position={[length * 0.5 + shaftLength * 0.5, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftLength, 24]} />
        <meshStandardMaterial
          color="#d4dbe2"
          metalness={0.92}
          roughness={0.2}
          transparent={preview}
          opacity={opacity}
        />
      </mesh>

      <mesh
        position={[0, -height * 0.5 - plateThickness * 0.34, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[length * 0.82, plateThickness, width * 1.06]} />
        <meshStandardMaterial
          color="#667380"
          metalness={0.82}
          roughness={0.33}
          transparent={preview}
          opacity={opacity}
        />
      </mesh>

      {[-1, 1].flatMap((xSide) =>
        [-1, 1].map((zSide) => (
          <mesh
            key={`${xSide}:${zSide}`}
            position={[
              xSide * length * 0.29,
              -height * 0.5 - plateThickness * 0.62,
              zSide * width * 0.44,
            ]}
            castShadow
          >
            <cylinderGeometry args={[boltRadius, boltRadius, 0.018, 12]} />
            <meshStandardMaterial
              color="#d2d9df"
              metalness={0.88}
              roughness={0.25}
              transparent={preview}
              opacity={opacity}
            />
          </mesh>
        ))
      )}

      {[-1, 1].map((side) => (
        <mesh
          key={`gear-bolt:${side}`}
          position={[
            length * 0.465,
            side * height * 0.27,
            side * width * 0.27,
          ]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[boltRadius * 0.82, boltRadius * 0.82, 0.018, 12]} />
          <meshStandardMaterial
            color="#e2e8ee"
            metalness={0.88}
            roughness={0.24}
            transparent={preview}
            opacity={opacity}
          />
        </mesh>
      ))}
    </group>
  );
}
