
import { RoundedBox } from "@react-three/drei";
import { Quaternion, Vector3 } from "three";

import type { WheelDefinition } from "../../features/robot-builder/types/robot.types";

type WheelModelProps = {
  radius: number;
  width: number;
  color: string;
  preview?: boolean;
  selected?: boolean;
  category?: WheelDefinition["category"];
};

export default function WheelModel({
  radius,
  width,
  color,
  preview = false,
  selected = false,
  category = "Rubber",
}: WheelModelProps) {
  const opacity = preview ? 0.48 : 1;
  const omni = category === "Omni";
  const grip = category === "Grip";
  const heavy = category === "Heavy-duty";

  const treadCount = heavy ? 20 : grip ? 30 : 22;

  const rubberColor = preview ? "#9aa8b6" : color;
  const treadColor = grip ? "#292f36" : heavy ? "#343b43" : "#414750";

  const rollerRadius = radius * 0.105;
  const hubRadius = radius * 0.32;

  const materialProps = {
    transparent: preview,
    opacity,
  };

  // Wheel axis is X.
  // The tyre circumference lies in the YZ plane.

  return (
    <group>
      {/* ================================== */}
      {/* 1. MAIN RUBBER TYRE BODY            */}
      {/* ================================== */}

      <mesh
        rotation={[0, 0, Math.PI / 2]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[radius, radius, width, 64]} />

        <meshStandardMaterial
          color={rubberColor}
          metalness={0.02}
          roughness={0.88}
          {...materialProps}
        />
      </mesh>

      {/* ================================== */}
      {/* 2. SIDEWALL DETAILS                 */}
      {/* ================================== */}

      {[-1, 1].map((side) => (
        <group
          key={`sidewall-${side}`}
          position={[side * width * 0.49, 0, 0]}
        >
          {/* Outer sidewall ring */}

          <mesh
            rotation={[0, Math.PI / 2, 0]}
          >
            <torusGeometry
              args={[
                radius * 0.83,
                radius * 0.035,
                10,
                64,
              ]}
            />

            <meshStandardMaterial
              color={rubberColor}
              roughness={0.92}
              {...materialProps}
            />
          </mesh>

          {/* Inner sidewall ring */}

          <mesh
            rotation={[0, Math.PI / 2, 0]}
          >
            <torusGeometry
              args={[
                radius * 0.59,
                radius * 0.018,
                8,
                48,
              ]}
            />

            <meshStandardMaterial
              color={treadColor}
              roughness={0.9}
              {...materialProps}
            />
          </mesh>
        </group>
      ))}

      {/* ================================== */}
      {/* 3. RUBBER / GRIP / HEAVY TREAD      */}
      {/* ================================== */}

      {!omni &&
        Array.from({ length: treadCount }, (_, index) => {
          const angle = (index / treadCount) * Math.PI * 2;

          const treadDepth = heavy
            ? radius * 0.17
            : grip
              ? radius * 0.13
              : radius * 0.085;

          const treadLength = heavy
            ? radius * 0.20
            : grip
              ? radius * 0.14
              : radius * 0.11;

          const treadWidth = heavy
            ? width * 0.92
            : width * 0.88;

          const treadPosition: [number, number, number] = [
            0,
            Math.sin(angle) * radius * 0.96,
            Math.cos(angle) * radius * 0.96,
          ];

          return (
            <group
              key={`tread-${index}`}
              position={treadPosition}
              rotation={[angle + Math.PI / 2, 0, 0]}
            >
              {grip ? (
                <>
                  {/* Left angled grip lug */}

                  <RoundedBox
                    args={[
                      treadWidth * 0.48,
                      treadDepth,
                      treadLength,
                    ]}
                    position={[
                      -width * 0.23,
                      0,
                      0,
                    ]}
                    rotation={[0, 0, -0.25]}
                    radius={radius * 0.025}
                    smoothness={3}
                    castShadow
                  >
                    <meshStandardMaterial
                      color={treadColor}
                      roughness={0.95}
                      {...materialProps}
                    />
                  </RoundedBox>

                  {/* Right angled grip lug */}

                  <RoundedBox
                    args={[
                      treadWidth * 0.48,
                      treadDepth,
                      treadLength,
                    ]}
                    position={[
                      width * 0.23,
                      0,
                      0,
                    ]}
                    rotation={[0, 0, 0.25]}
                    radius={radius * 0.025}
                    smoothness={3}
                    castShadow
                  >
                    <meshStandardMaterial
                      color={treadColor}
                      roughness={0.95}
                      {...materialProps}
                    />
                  </RoundedBox>
                </>
              ) : (
                <RoundedBox
                  args={[
                    treadWidth,
                    treadDepth,
                    treadLength,
                  ]}
                  radius={radius * 0.025}
                  smoothness={3}
                  castShadow
                >
                  <meshStandardMaterial
                    color={treadColor}
                    roughness={0.94}
                    {...materialProps}
                  />
                </RoundedBox>
              )}
            </group>
          );
        })}

      {/* ================================== */}
      {/* 4. OMNI WHEEL ROLLERS              */}
      {/* ================================== */}

      {omni &&
        Array.from({ length: 12 }, (_, index) => {
          const angle = (index / 12) * Math.PI * 2;

          const rollerAngle = Math.PI / 4;

          const axis = new Vector3(
            Math.cos(rollerAngle),
            Math.sin(rollerAngle) * Math.cos(angle),
            -Math.sin(rollerAngle) * Math.sin(angle)
          ).normalize();

          const quaternion = new Quaternion().setFromUnitVectors(
            new Vector3(0, 1, 0),
            axis
          );

          return (
            <group
              key={`omni-roller-${index}`}
              position={[
                0,
                Math.sin(angle) * radius * 0.91,
                Math.cos(angle) * radius * 0.91,
              ]}
              quaternion={quaternion}
            >
              <mesh castShadow receiveShadow>
                <cylinderGeometry
                  args={[
                    rollerRadius,
                    rollerRadius,
                    width * 0.92,
                    20,
                  ]}
                />

                <meshStandardMaterial
                  color={preview ? "#9aa8b6" : "#242b32"}
                  metalness={0.04}
                  roughness={0.82}
                  {...materialProps}
                />
              </mesh>

              {/* Roller end caps */}

              {[-1, 1].map((side) => (
                <mesh
                  key={`roller-cap-${side}`}
                  position={[0, side * width * 0.46, 0]}
                  rotation={[Math.PI / 2, 0, 0]}
                >
                  <cylinderGeometry
                    args={[
                      rollerRadius * 0.7,
                      rollerRadius * 0.7,
                      width * 0.035,
                      12,
                    ]}
                  />

                  <meshStandardMaterial
                    color="#89949e"
                    metalness={0.65}
                    roughness={0.4}
                    {...materialProps}
                  />
                </mesh>
              ))}
            </group>
          );
        })}

      {/* ================================== */}
      {/* 5. METALLIC SIDE RIMS              */}
      {/* ================================== */}

      {[-1, 1].map((side) => (
        <group
          key={`rim-${side}`}
          position={[side * width * 0.48, 0, 0]}
        >
          {/* Main metallic rim */}

          <mesh
            rotation={[0, 0, Math.PI / 2]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry
              args={[
                radius * 0.58,
                radius * 0.58,
                width * 0.075,
                48,
              ]}
            />

            <meshStandardMaterial
              color="#768491"
              metalness={0.86}
              roughness={0.28}
              emissive={selected ? "#0284c7" : "#000000"}
              emissiveIntensity={selected ? 0.25 : 0}
              {...materialProps}
            />
          </mesh>

          {/* Raised rim ring */}

          <mesh
            rotation={[0, Math.PI / 2, 0]}
          >
            <torusGeometry
              args={[
                radius * 0.52,
                radius * 0.035,
                10,
                48,
              ]}
            />

            <meshStandardMaterial
              color="#aeb9c3"
              metalness={0.88}
              roughness={0.28}
              {...materialProps}
            />
          </mesh>

          {/* Recessed inner hub */}

          <mesh
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry
              args={[
                hubRadius,
                hubRadius,
                width * 0.10,
                32,
              ]}
            />

            <meshStandardMaterial
              color="#87939e"
              metalness={0.9}
              roughness={0.28}
              {...materialProps}
            />
          </mesh>

          {/* Central axle cap */}

          <mesh
            position={[side * width * 0.095, 0, 0]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry
              args={[
                radius * 0.17,
                radius * 0.17,
                width * 0.10,
                32,
              ]}
            />

            <meshStandardMaterial
              color="#cbd5df"
              metalness={0.94}
              roughness={0.2}
              {...materialProps}
            />
          </mesh>

          {/* Axle opening */}

          <mesh
            position={[side * width * 0.15, 0, 0]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry
              args={[
                radius * 0.075,
                radius * 0.075,
                width * 0.025,
                24,
              ]}
            />

            <meshStandardMaterial
              color="#35414c"
              metalness={0.72}
              roughness={0.35}
              {...materialProps}
            />
          </mesh>

          {/* ================================== */}
          {/* 6. HEXAGONAL HUB BOLTS              */}
          {/* ================================== */}

          {Array.from({ length: 6 }, (_, index) => {
            const angle = (index / 6) * Math.PI * 2;

            return (
              <mesh
                key={`hub-bolt-${index}`}
                position={[
                  side * width * 0.085,
                  Math.sin(angle) * radius * 0.40,
                  Math.cos(angle) * radius * 0.40,
                ]}
                rotation={[0, 0, Math.PI / 2]}
                castShadow
              >
                <cylinderGeometry
                  args={[
                    radius * 0.045,
                    radius * 0.045,
                    width * 0.055,
                    6,
                  ]}
                />

                <meshStandardMaterial
                  color="#e0e6ec"
                  metalness={0.94}
                  roughness={0.22}
                  {...materialProps}
                />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}
