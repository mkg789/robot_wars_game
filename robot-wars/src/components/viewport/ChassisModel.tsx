
import { RoundedBox } from "@react-three/drei";

type ChassisModelProps = {
  size: [number, number, number];
  color: string;
  selected?: boolean;
  preview?: boolean;
};

// Shared material settings
function getMaterialProps(preview: boolean) {
  return {
    transparent: preview,
    opacity: preview ? 0.48 : 1,
  };
}

// ==========================================
// REUSABLE METALLIC FASTENER
// ==========================================

function Fastener({
  radius,
  preview = false,
}: {
  radius: number;
  preview?: boolean;
}) {
  const materialProps = getMaterialProps(preview);

  return (
    <group>
      {/* Outer metallic washer */}
      <mesh
        position={[0, 0.003, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry
          args={[radius * 1.08, radius * 0.18, 8, 20]}
        />
        <meshStandardMaterial
          color="#aab5bf"
          metalness={0.88}
          roughness={0.28}
          {...materialProps}
        />
      </mesh>

      {/* Screw head */}
      <mesh position={[0, 0.004, 0]}>
        <cylinderGeometry
          args={[radius * 0.82, radius * 0.82, radius * 0.38, 6]}
        />
        <meshStandardMaterial
          color="#82909d"
          metalness={0.9}
          roughness={0.3}
          {...materialProps}
        />
      </mesh>

      {/* Recessed socket */}
      <mesh position={[0, 0.007, 0]}>
        <cylinderGeometry
          args={[radius * 0.32, radius * 0.32, radius * 0.12, 6]}
        />
        <meshStandardMaterial
          color="#263442"
          metalness={0.5}
          roughness={0.5}
          {...materialProps}
        />
      </mesh>
    </group>
  );
}

// ==========================================
// REUSABLE CHASSIS MOUNTING POINT
// ==========================================

function MountingPoint({
  radius,
  preview = false,
}: {
  radius: number;
  preview?: boolean;
}) {
  const materialProps = getMaterialProps(preview);

  return (
    <group>
      {/* Mounting pad */}
      <mesh position={[0, 0.002, 0]}>
        <cylinderGeometry
          args={[radius * 2.1, radius * 2.1, radius * 0.28, 32]}
        />
        <meshStandardMaterial
          color="#526271"
          metalness={0.78}
          roughness={0.36}
          {...materialProps}
        />
      </mesh>

      {/* Metallic mounting ring */}
      <mesh
        position={[0, radius * 0.16, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry
          args={[radius * 1.45, radius * 0.12, 8, 24]}
        />
        <meshStandardMaterial
          color="#c0cad3"
          metalness={0.9}
          roughness={0.28}
          {...materialProps}
        />
      </mesh>

      {/* Dark recessed mounting hole indicator */}
      <mesh position={[0, radius * 0.18, 0]}>
        <cylinderGeometry
          args={[radius * 0.72, radius * 0.72, radius * 0.08, 24]}
        />
        <meshStandardMaterial
          color="#1e2935"
          metalness={0.55}
          roughness={0.55}
          {...materialProps}
        />
      </mesh>
    </group>
  );
}

// ==========================================
// MAIN CHASSIS MODEL
// ==========================================

export function ChassisModel({
  size,
  color,
  selected = false,
  preview = false,
}: ChassisModelProps) {
  const [length, height, width] = size;

  const materialProps = getMaterialProps(preview);

  const edgeRailWidth = Math.min(0.055, width * 0.045);
  const edgeRailHeight = Math.min(0.09, height * 0.28);

  const endPlateThickness = Math.min(0.055, length * 0.045);

  const boltRadius = Math.min(
    0.026,
    length * 0.012,
    width * 0.018
  );

  const railColor = selected ? "#bd904b" : "#82909e";

  // Four main chassis corner fasteners
  const boltPositions = [-1, 1].flatMap((xSide) =>
    [-1, 1].map((zSide) => [
      xSide * length * 0.42,
      height * 0.5,
      zSide * width * 0.35,
    ] as [number, number, number])
  );

  // Four additional mounting points
  const mountingPositions = [-1, 1].flatMap((xSide) =>
    [-1, 1].map((zSide) => [
      xSide * length * 0.29,
      height * 0.5,
      zSide * width * 0.27,
    ] as [number, number, number])
  );

  return (
    <group>
      {/* ================================== */}
      {/* 1. MAIN STRUCTURAL CHASSIS         */}
      {/* ================================== */}

      <RoundedBox
        args={size}
        radius={Math.min(
          0.055,
          height * 0.18,
          length * 0.04,
          width * 0.04
        )}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={color}
          metalness={0.72}
          roughness={0.34}
          emissive={selected ? "#754b1b" : "#000000"}
          emissiveIntensity={selected ? 0.12 : 0}
          {...materialProps}
        />
      </RoundedBox>

      {/* ================================== */}
      {/* 2. REINFORCED SIDE RAILS            */}
      {/* ================================== */}

      {[-1, 1].map((side) => (
        <RoundedBox
          key={`side-rail-${side}`}
          args={[
            length * 0.94,
            edgeRailHeight,
            edgeRailWidth,
          ]}
          position={[
            0,
            height * 0.5 + edgeRailHeight * 0.5,
            side * (width * 0.5 - edgeRailWidth * 0.5),
          ]}
          radius={edgeRailWidth * 0.3}
          smoothness={3}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color={railColor}
            metalness={0.82}
            roughness={0.29}
            {...materialProps}
          />
        </RoundedBox>
      ))}

      {/* ================================== */}
      {/* 3. FRONT AND REAR REINFORCEMENT     */}
      {/* ================================== */}

      {[-1, 1].map((side) => (
        <RoundedBox
          key={`end-plate-${side}`}
          args={[
            endPlateThickness,
            height * 0.82,
            width * 0.90,
          ]}
          position={[
            side * (length * 0.5 - endPlateThickness * 0.5),
            0,
            0,
          ]}
          radius={Math.min(
            0.025,
            height * 0.08,
            width * 0.025
          )}
          smoothness={3}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color="#536170"
            metalness={0.78}
            roughness={0.35}
            {...materialProps}
          />
        </RoundedBox>
      ))}

      {/* ================================== */}
      {/* 4. SIDE RAIL FASTENERS              */}
      {/* ================================== */}

      {[-1, 1].flatMap((side) =>
        [-0.32, 0, 0.32].map((fraction, index) => (
          <group
            key={`rail-fastener-${side}-${index}`}
            position={[
              fraction * length,
              height * 0.5 + edgeRailHeight,
              side * (width * 0.5 - edgeRailWidth * 0.5),
            ]}
          >
            <Fastener
              radius={boltRadius * 0.8}
              preview={preview}
            />
          </group>
        ))
      )}

      {/* ================================== */}
      {/* 5. CHASSIS CORNER FASTENERS         */}
      {/* ================================== */}

      {boltPositions.map(([x, y, z], index) => (
        <group
          key={`chassis-bolt-${index}`}
          position={[x, y, z]}
        >
          <Fastener
            radius={boltRadius}
            preview={preview}
          />
        </group>
      ))}

      {/* ================================== */}
      {/* 6. COMPONENT MOUNTING POINTS        */}
      {/* ================================== */}

      {mountingPositions.map(([x, y, z], index) => (
        <group
          key={`mounting-point-${index}`}
          position={[x, y, z]}
        >
          <MountingPoint
            radius={boltRadius * 1.7}
            preview={preview}
          />
        </group>
      ))}
    </group>
  );
}

// ==========================================
// SEPARATE TOP ARMOUR PLATE
// ==========================================

export function TopPlateModel({
  size,
  color,
  selected = false,
  preview = false,
}: ChassisModelProps) {
  const [length, thickness, width] = size;

  const materialProps = getMaterialProps(preview);

  const boltRadius = Math.min(
    0.024,
    length * 0.012,
    width * 0.018
  );

  const fasteners = [-1, 1].flatMap((side) =>
    [-0.38, -0.19, 0, 0.19, 0.38].map(
      (fraction, index) => [
        fraction * length,
        thickness * 0.5,
        side * width * 0.39,
        index + (side + 1) * 5,
      ] as [number, number, number, number]
    )
  );

  return (
    <group>
      {/* Main armour plate */}

      <RoundedBox
        args={size}
        radius={Math.min(
          0.045,
          thickness * 0.28,
          length * 0.025,
          width * 0.025
        )}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={color}
          metalness={0.84}
          roughness={0.29}
          emissive={selected ? "#754b1b" : "#000000"}
          emissiveIntensity={selected ? 0.12 : 0}
          {...materialProps}
        />
      </RoundedBox>

      {/* Top plate fasteners */}

      {fasteners.map(([x, y, z, id]) => (
        <group
          key={`top-plate-fastener-${id}`}
          position={[x, y, z]}
        >
          <Fastener
            radius={boltRadius}
            preview={preview}
          />
        </group>
      ))}

      {/* Additional reinforcement strips */}

      {[-1, 1].map((side) => (
        <RoundedBox
          key={`top-reinforcement-${side}`}
          args={[
            length * 0.86,
            thickness * 0.12,
            Math.min(0.025, width * 0.025),
          ]}
          position={[
            0,
            -thickness * 0.3,
            side * width * 0.28,
          ]}
          radius={0.008}
          smoothness={2}
          castShadow
        >
          <meshStandardMaterial
            color="#647381"
            metalness={0.78}
            roughness={0.35}
            {...materialProps}
          />
        </RoundedBox>
      ))}
    </group>
  );
}
