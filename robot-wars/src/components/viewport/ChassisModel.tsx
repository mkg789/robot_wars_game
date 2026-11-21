import { RoundedBox } from "@react-three/drei";

type ChassisModelProps = {
  size: [number, number, number];
  color: string;
  selected?: boolean;
};

function Fastener({ radius }: { radius: number }) {
  return (
    <group>
      <mesh position={[0, 0.004, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 1.08, radius * 0.18, 6, 16]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.78} roughness={0.32} />
      </mesh>
      <mesh position={[0, 0.003, 0]}>
        <cylinderGeometry args={[radius * 0.8, radius * 0.8, 0.006, 16]} />
        <meshStandardMaterial color="#1e293b" metalness={0.35} roughness={0.52} />
      </mesh>
      <mesh position={[0, 0.007, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[radius * 0.9, 0.002, radius * 0.12]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.82} roughness={0.28} />
      </mesh>
    </group>
  );
}

export function ChassisModel({
  size,
  color,
  selected = false,
}: ChassisModelProps) {
  const [length, height, width] = size;
  const edgeRailWidth = Math.min(0.055, width * 0.045);
  const edgeRailHeight = Math.min(0.09, height * 0.28);
  const boltRadius = Math.min(0.026, length * 0.012, width * 0.018);
  const boltPositions = [-1, 1].flatMap((xSide) =>
    [-1, 1].map((zSide) => [
      xSide * length * 0.42,
      height * 0.5,
      zSide * width * 0.42,
    ] as [number, number, number])
  );

  return (
    <group>
      <RoundedBox
        args={size}
        radius={Math.min(0.055, height * 0.18, length * 0.04, width * 0.04)}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={color}
          metalness={0.68}
          roughness={0.38}
          emissive={selected ? "#754b1b" : "#000000"}
          emissiveIntensity={selected ? 0.1 : 0}
        />
      </RoundedBox>

      <RoundedBox
        args={[length * 0.94, edgeRailHeight, edgeRailWidth]}
        position={[0, height * 0.08, width * 0.47]}
        radius={edgeRailWidth * 0.3}
        smoothness={2}
        castShadow
      >
        <meshStandardMaterial
          color={selected ? "#bd904b" : "#82909e"}
          metalness={0.78}
          roughness={0.32}
        />
      </RoundedBox>
      <RoundedBox
        args={[length * 0.94, edgeRailHeight, edgeRailWidth]}
        position={[0, height * 0.08, -width * 0.47]}
        radius={edgeRailWidth * 0.3}
        smoothness={2}
        castShadow
      >
        <meshStandardMaterial
          color={selected ? "#bd904b" : "#82909e"}
          metalness={0.78}
          roughness={0.32}
        />
      </RoundedBox>

      <RoundedBox
        args={[length * 0.045, height * 0.62, width * 0.88]}
        position={[length * 0.455, 0, 0]}
        radius={Math.min(0.025, height * 0.08)}
        smoothness={2}
        castShadow
      >
        <meshStandardMaterial color="#536170" metalness={0.72} roughness={0.4} />
      </RoundedBox>
      <RoundedBox
        args={[length * 0.045, height * 0.62, width * 0.88]}
        position={[-length * 0.455, 0, 0]}
        radius={Math.min(0.025, height * 0.08)}
        smoothness={2}
        castShadow
      >
        <meshStandardMaterial color="#536170" metalness={0.72} roughness={0.4} />
      </RoundedBox>

      {boltPositions.map(([x, y, z], index) => (
        <group key={index} position={[x, y, z]}>
          <Fastener radius={boltRadius} />
        </group>
      ))}
    </group>
  );
}

export function TopPlateModel({ size, color }: ChassisModelProps) {
  const [length, thickness, width] = size;
  const boltRadius = Math.min(0.024, length * 0.012, width * 0.018);
  const fasteners = [-1, 1].flatMap((side) =>
    [-0.38, -0.19, 0, 0.19, 0.38].map((fraction, index) => [
      fraction * length,
      thickness * 0.5,
      side * width * 0.39,
      index + (side + 1) * 5,
    ] as [number, number, number, number])
  );

  return (
    <group>
      <RoundedBox
        args={size}
        radius={Math.min(0.045, thickness * 0.28, length * 0.025, width * 0.025)}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={color} metalness={0.82} roughness={0.3} />
      </RoundedBox>
      {fasteners.map(([x, y, z, id]) => (
        <group key={id} position={[x, y, z]}>
          <Fastener radius={boltRadius} />
        </group>
      ))}
    </group>
  );
}
