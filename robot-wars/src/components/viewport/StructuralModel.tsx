import { RoundedBox } from "@react-three/drei";
import type { StructuralVisualShape } from "../../features/robot-builder/types/robot.types";

type StructuralModelProps = {
  size: [number, number, number];
  shape: StructuralVisualShape;
  color: string;
  selected?: boolean;
  preview?: boolean;
};

export default function StructuralModel({
  size,
  shape,
  color,
  selected = false,
  preview = false,
}: StructuralModelProps) {
  const [length, height, width] = size;
  const radius = Math.min(length, height, width);
  const emissive = selected ? "#0284c7" : "#000000";
  const emissiveIntensity = selected ? 0.25 : 0;
  const materialProps = {
    transparent: preview,
    opacity: preview ? 0.48 : 1,
    emissive,
    emissiveIntensity,
  };

  switch (shape) {
    case "hex-standoff": {
      const outerRadius = Math.min(length, width) * 0.5;
      return (
        <group>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[outerRadius, outerRadius, height * 0.86, 6]} />
            <meshStandardMaterial
              color={color}
              metalness={0.85}
              roughness={0.28}
              {...materialProps}
            />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={`standoff-cap-${side}`}
              position={[0, side * height * 0.45, 0]}
              castShadow
            >
              <cylinderGeometry
                args={[outerRadius * 0.55, outerRadius * 0.55, height * 0.1, 16]}
              />
              <meshStandardMaterial
                color="#475569"
                metalness={0.9}
                roughness={0.25}
                {...materialProps}
              />
            </mesh>
          ))}
        </group>
      );
    }

    case "spacer": {
      const outerRadius = Math.min(length, width) * 0.5;
      return (
        <group>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[outerRadius, outerRadius, height, 28]} />
            <meshStandardMaterial
              color={color}
              metalness={0.75}
              roughness={0.34}
              {...materialProps}
            />
          </mesh>
          <mesh position={[0, height * 0.505, 0]}>
            <cylinderGeometry args={[outerRadius * 0.46, outerRadius * 0.46, 0.004, 20]} />
            <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} {...materialProps} />
          </mesh>
        </group>
      );
    }

    case "l-bracket": {
      const legThickness = Math.max(0.012, radius * 0.24);
      return (
        <group>
          {/* Horizontal bottom leg */}
          <RoundedBox
            args={[length, legThickness, width]}
            position={[0, -height * 0.5 + legThickness * 0.5, 0]}
            radius={Math.min(0.008, legThickness * 0.25)}
            smoothness={2}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={color} metalness={0.78} roughness={0.32} {...materialProps} />
          </RoundedBox>
          {/* Vertical flange leg */}
          <RoundedBox
            args={[legThickness, height, width]}
            position={[length * 0.5 - legThickness * 0.5, 0, 0]}
            radius={Math.min(0.008, legThickness * 0.25)}
            smoothness={2}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={color} metalness={0.78} roughness={0.32} {...materialProps} />
          </RoundedBox>
          {/* Corner gusset */}
          <mesh position={[length * 0.15, -height * 0.15, 0]} castShadow>
            <boxGeometry args={[length * 0.45, height * 0.45, width * 0.25]} />
            <meshStandardMaterial color="#475569" metalness={0.82} roughness={0.3} {...materialProps} />
          </mesh>
        </group>
      );
    }

    case "mounting-bracket": {
      const wallT = Math.max(0.012, radius * 0.2);
      return (
        <group>
          {/* Base plate */}
          <RoundedBox
            args={[length, wallT, width]}
            position={[0, -height * 0.5 + wallT * 0.5, 0]}
            radius={0.006}
            smoothness={2}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={color} metalness={0.78} roughness={0.32} {...materialProps} />
          </RoundedBox>
          {/* Side saddle ears */}
          {[-1, 1].map((side) => (
            <RoundedBox
              key={`ear-${side}`}
              args={[length * 0.85, height, wallT]}
              position={[0, 0, side * (width * 0.5 - wallT * 0.5)]}
              radius={0.006}
              smoothness={2}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} {...materialProps} />
            </RoundedBox>
          ))}
        </group>
      );
    }

    case "flat-plate": {
      const holeR = Math.min(0.014, Math.min(length, width) * 0.045);
      return (
        <group>
          <RoundedBox
            args={[length, height, width]}
            radius={Math.min(0.015, height * 0.35)}
            smoothness={3}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={color} metalness={0.8} roughness={0.3} {...materialProps} />
          </RoundedBox>
          {[-1, 1].flatMap((xSide) =>
            [-1, 1].map((zSide) => (
              <mesh
                key={`plate-hole-${xSide}-${zSide}`}
                position={[xSide * length * 0.4, height * 0.51, zSide * width * 0.38]}
              >
                <cylinderGeometry args={[holeR, holeR, 0.004, 16]} />
                <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.5} {...materialProps} />
              </mesh>
            ))
          )}
        </group>
      );
    }

    case "structural-rail":
    case "adjustable-bar": {
      const flangeH = height * 0.28;
      return (
        <group>
          <RoundedBox
            args={[length, height, width]}
            radius={Math.min(0.012, radius * 0.2)}
            smoothness={2}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={color} metalness={0.82} roughness={0.28} {...materialProps} />
          </RoundedBox>
          {/* T-slot channel accent strip */}
          <mesh position={[0, height * 0.505, 0]}>
            <boxGeometry args={[length * 0.92, flangeH * 0.2, width * 0.34]} />
            <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} {...materialProps} />
          </mesh>
          <mesh position={[0, 0, width * 0.505]}>
            <boxGeometry args={[length * 0.92, height * 0.34, 0.004]} />
            <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} {...materialProps} />
          </mesh>
          <mesh position={[0, 0, -width * 0.505]}>
            <boxGeometry args={[length * 0.92, height * 0.34, 0.004]} />
            <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} {...materialProps} />
          </mesh>
        </group>
      );
    }

    case "crossbar":
    case "box-beam": {
      return (
        <group>
          <RoundedBox
            args={[length, height, width]}
            radius={Math.min(0.014, radius * 0.18)}
            smoothness={3}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={color} metalness={0.82} roughness={0.3} {...materialProps} />
          </RoundedBox>
          {[-1, 1].map((side) => (
            <mesh
              key={`cap-${side}`}
              position={
                shape === "crossbar"
                  ? [0, 0, side * (width * 0.5 - 0.012)]
                  : [side * (length * 0.5 - 0.012), 0, 0]
              }
            >
              <boxGeometry
                args={
                  shape === "crossbar"
                    ? [length * 1.06, height * 1.06, 0.024]
                    : [0.024, height * 1.06, width * 1.06]
                }
              />
              <meshStandardMaterial color="#334155" metalness={0.86} roughness={0.28} {...materialProps} />
            </mesh>
          ))}
        </group>
      );
    }

    case "reinforced-bumper": {
      return (
        <group>
          <RoundedBox
            args={[length, height, width]}
            radius={Math.min(0.04, radius * 0.3)}
            smoothness={3}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={color} metalness={0.52} roughness={0.36} {...materialProps} />
          </RoundedBox>
          {[-0.36, 0, 0.36].map((zFrac, idx) => (
            <mesh
              key={`bumper-rib-${idx}`}
              position={[length * 0.505, 0, zFrac * width]}
              castShadow
            >
              <boxGeometry args={[0.018, height * 0.72, width * 0.06]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} {...materialProps} />
            </mesh>
          ))}
        </group>
      );
    }
  }
}
