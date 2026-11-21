import type { WheelDefinition } from "../../features/robot-builder/types/robot.types";

type WheelModelProps = {
  radius: number;
  width: number;
  color: string;
  preview?: boolean;
  category?: WheelDefinition["category"];
};

export default function WheelModel({
  radius,
  width,
  color,
  preview = false,
  category = "Rubber",
}: WheelModelProps) {
  const opacity = preview ? 0.48 : 1;
  const omni = category === "Omni";
  const treadCount =
    category === "Heavy-duty" ? 18 : category === "Grip" ? 28 : 16;
  const treadRadiusScale = category === "Heavy-duty" ? 0.94 : 0.97;

  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, width, 40]} />
        <meshStandardMaterial
          color={preview ? "#9aa8b6" : color}
          metalness={preview ? 0.22 : 0.05}
          roughness={preview ? 0.56 : 0.82}
          transparent={preview}
          opacity={opacity}
        />
      </mesh>
      {Array.from({ length: omni ? 10 : treadCount }, (_, index) => {
        const count = omni ? 10 : treadCount;
        const angle = (index / count) * Math.PI * 2;
        return omni ? (
          <mesh
            key={index}
            position={[
              0,
              Math.sin(angle) * radius * 0.88,
              Math.cos(angle) * radius * 0.88,
            ]}
            rotation={[angle + Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry
              args={[radius * 0.12, radius * 0.12, width * 0.76, 12]}
            />
            <meshStandardMaterial
              color="#aab4c0"
              metalness={0.35}
              roughness={0.55}
              transparent={preview}
              opacity={opacity}
            />
          </mesh>
        ) : (
          <mesh
            key={index}
            position={[
              0,
              Math.sin(angle) * radius * treadRadiusScale,
              Math.cos(angle) * radius * treadRadiusScale,
            ]}
            rotation={[
              angle + (category === "Grip" ? 0.28 : 0),
              0,
              0,
            ]}
            castShadow
          >
            <boxGeometry
              args={[
                width * (category === "Heavy-duty" ? 0.9 : 0.82),
                radius * (category === "Heavy-duty" ? 0.18 : 0.12),
                radius * (category === "Heavy-duty" ? 0.15 : 0.1),
              ]}
            />
            <meshStandardMaterial
              color={category === "Grip" ? "#505762" : "#414750"}
              roughness={0.9}
              transparent={preview}
              opacity={opacity}
            />
          </mesh>
        );
      })}
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[side * width * 0.36, 0, 0]}
        >
          <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
            <torusGeometry args={[radius * 0.76, radius * 0.045, 8, 32]} />
            <meshStandardMaterial
              color="#64748b"
              metalness={0.55}
              roughness={0.4}
              transparent={preview}
              opacity={opacity}
            />
          </mesh>
          <mesh
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry
              args={[radius * 0.31, radius * 0.31, width * 0.32, 24]}
            />
            <meshStandardMaterial
              color="#cbd5e1"
              metalness={0.82}
              roughness={0.25}
              transparent={preview}
              opacity={opacity}
            />
          </mesh>
          {Array.from({ length: 6 }, (_, index) => {
            const angle = (index / 6) * Math.PI * 2;
            return (
              <mesh
                key={`hub-bolt:${index}`}
                position={[
                  side * width * 0.53,
                  Math.sin(angle) * radius * 0.22,
                  Math.cos(angle) * radius * 0.22,
                ]}
                rotation={[0, 0, Math.PI / 2]}
                castShadow
              >
                <cylinderGeometry
                  args={[radius * 0.035, radius * 0.035, width * 0.035, 10]}
                />
                <meshStandardMaterial
                  color="#e2e8ee"
                  metalness={0.86}
                  roughness={0.28}
                  transparent={preview}
                  opacity={opacity}
                />
              </mesh>
            );
          })}
          {side === 1 && (
            <mesh
              position={[width * 0.54, 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            >
              <cylinderGeometry
                args={[radius * 0.16, radius * 0.16, width * 0.04, 20]}
              />
              <meshStandardMaterial
                color="#94a3b8"
                metalness={0.86}
                roughness={0.26}
                transparent={preview}
                opacity={opacity}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
