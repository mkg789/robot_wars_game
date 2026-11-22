
import { useEffect, useMemo, useRef } from "react";
import { RoundedBox } from "@react-three/drei";
import {
  CatmullRomCurve3,
  CanvasTexture,
  DoubleSide,
  SRGBColorSpace,
  Vector3,
} from "three";

export type BatteryDesign =
  | "soft-2s"
  | "hardcase-3s"
  | "drone-6s";

type BatteryModelProps = {
  size: [number, number, number];
  color: string;
  selected?: boolean;
  label?: string;
  voltage?: number;
  capacityMah?: number;
  cellCount?: number;
  design?: BatteryDesign;
  typeLabel?: string;
};

function Screw({
  position,
  scale,
}: {
  position: [number, number, number];
  scale: number;
}) {
  return (
    <group position={position}>
      <mesh>
        <cylinderGeometry args={[scale, scale, scale * 0.22, 12]} />
        <meshStandardMaterial
          color="#aab2bc"
          metalness={0.9}
          roughness={0.24}
        />
      </mesh>
      <mesh position={[0, scale * 0.12, 0]}>
        <boxGeometry args={[scale * 1.1, scale * 0.08, scale * 0.16]} />
        <meshStandardMaterial color="#303741" />
      </mesh>
    </group>
  );
}

function BatteryLabel({
  length,
  height,
  width,
  label,
  specs,
  surfaceY,
  badgeLengthRatio,
  badgeWidthRatio,
}: {
  length: number;
  height: number;
  width: number;
  label: string;
  specs: string;
  surfaceY: number;
  badgeLengthRatio: number;
  badgeWidthRatio: number;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create the battery label texture.");
    }

    context.fillStyle = "#141b24";
    context.strokeStyle = "#657181";
    context.lineWidth = 8;
    const inset = 24;
    const right = canvas.width - inset;
    const bottom = canvas.height - inset;
    const radius = 36;
    context.beginPath();
    context.moveTo(inset + radius, inset);
    context.lineTo(right - radius, inset);
    context.arcTo(right, inset, right, inset + radius, radius);
    context.lineTo(right, bottom - radius);
    context.arcTo(right, bottom, right - radius, bottom, radius);
    context.lineTo(inset + radius, bottom);
    context.arcTo(inset, bottom, inset, bottom - radius, radius);
    context.lineTo(inset, inset + radius);
    context.arcTo(inset, inset, inset + radius, inset, radius);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = "#f59e0b";
    context.fillRect(64, 72, 896, 16);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#f8fafc";
    context.font = "bold 104px Arial";
    context.fillText(label.toUpperCase(), 512, 196, 900);
    context.fillStyle = "#cbd5e1";
    context.font = "bold 48px Arial";
    context.fillText(specs, 512, 322, 900);
    context.fillStyle = "#94a3b8";
    context.font = "32px Arial";
    context.fillText("CAUTION | RW POWER", 512, 420, 900);

    const labelTexture = new CanvasTexture(canvas);
    labelTexture.colorSpace = SRGBColorSpace;
    labelTexture.needsUpdate = true;
    return labelTexture;
  }, [label, specs]);

  const textureRef = useRef<CanvasTexture | null>(null);
  useEffect(() => {
    textureRef.current = texture;
    return () => {
      textureRef.current = null;
      Promise.resolve().then(() => {
        if (textureRef.current !== texture) texture.dispose();
      });
    };
  }, [texture]);

  return (
    <group>
      <RoundedBox
        args={[
          length * badgeLengthRatio,
          height * 0.02,
          width * badgeWidthRatio,
        ]}
        position={[0, surfaceY + height * 0.01, 0]}
        radius={Math.min(height, width) * 0.018}
        smoothness={3}
      >
        <meshStandardMaterial
          color="#141b24"
          metalness={0.12}
          roughness={0.72}
        />
      </RoundedBox>

      <mesh
        position={[0, surfaceY + height * 0.04, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry
          args={[
            length * badgeLengthRatio,
            width * badgeWidthRatio,
          ]}
        />
        <meshBasicMaterial
          map={texture}
          transparent
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export default function BatteryModel({
  size,
  color,
  selected = false,
  label = "RW POWER",
  voltage,
  capacityMah,
  cellCount,
  design,
  typeLabel,
}: BatteryModelProps) {
  const [length, height, width] = size;

  const safeLength = Math.max(length, 0.001);
  const safeHeight = Math.max(height, 0.001);
  const safeWidth = Math.max(width, 0.001);

  const minDimension = Math.min(safeHeight, safeWidth);

  // Select the construction style.
  const batteryDesign: BatteryDesign =
    design ??
    (cellCount === 3
      ? "hardcase-3s"
      : cellCount != null && cellCount >= 4
        ? "drone-6s"
        : "soft-2s");
  const resolvedTypeLabel =
    typeLabel ??
    (batteryDesign === "soft-2s"
      ? "SOFT POUCH"
      : batteryDesign === "hardcase-3s"
        ? "HARDCASE"
        : "DRONE PACK");

  const specs = [
    resolvedTypeLabel,
    voltage != null ? `${voltage}V` : null,
    capacityMah != null ? `${capacityMah}mAh` : null,
    cellCount != null ? `${cellCount}S` : null,
  ]
    .filter(Boolean)
    .join("  /  ");

  const strapColor = "#191f28";

  const redWire = useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(safeLength * 0.38, safeHeight * 0.08, -safeWidth * 0.19),
        new Vector3(safeLength * 0.48, safeHeight * 0.25, -safeWidth * 0.26),
        new Vector3(safeLength * 0.63, safeHeight * 0.29, -safeWidth * 0.30),
        new Vector3(safeLength * 0.77, safeHeight * 0.15, -safeWidth * 0.26),
      ]),
    [safeLength, safeHeight, safeWidth]
  );

  const blackWire = useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(safeLength * 0.38, safeHeight * 0.08, safeWidth * 0.19),
        new Vector3(safeLength * 0.48, safeHeight * 0.25, safeWidth * 0.26),
        new Vector3(safeLength * 0.63, safeHeight * 0.29, safeWidth * 0.30),
        new Vector3(safeLength * 0.77, safeHeight * 0.15, safeWidth * 0.26),
      ]),
    [safeLength, safeHeight, safeWidth]
  );

  const wireRadius = minDimension * 0.027;

  return (
    <group>
      {/* ================================================= */}
      {/* 1. SOFT PACK - 2S RC LIPO                          */}
      {/* ================================================= */}

      {batteryDesign === "soft-2s" && (
        <group>
          {/* Flexible heat-shrink battery pouch */}
          <RoundedBox
            args={[safeLength, safeHeight * 0.88, safeWidth]}
            position={[0, 0, 0]}
            radius={minDimension * 0.105}
            smoothness={8}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={color}
              metalness={0.06}
              roughness={0.36}
              emissive={selected ? "#b7791f" : "#000000"}
              emissiveIntensity={selected ? 0.07 : 0}
            />
          </RoundedBox>

          {/* Heat-shrink folded end seams */}
          {[-1, 1].map((side) => (
            <RoundedBox
              key={side}
              args={[
                safeLength * 0.035,
                safeHeight * 0.79,
                safeWidth * 0.96,
              ]}
              position={[side * safeLength * 0.47, 0, 0]}
              radius={minDimension * 0.025}
              smoothness={3}
            >
              <meshStandardMaterial
                color="#b8bdc4"
                metalness={0.08}
                roughness={0.53}
              />
            </RoundedBox>
          ))}

          {/* Raised pouch cells make the 2S construction visible */}
          {[-1, 1].map((side) => (
            <RoundedBox
              key={side}
              args={[
                safeLength * 0.44,
                safeHeight * 0.12,
                safeWidth * 0.88,
              ]}
              position={[side * safeLength * 0.235, safeHeight * 0.4, 0]}
              radius={minDimension * 0.07}
              smoothness={6}
              castShadow
            >
              <meshStandardMaterial
                color={color}
                metalness={0.03}
                roughness={0.32}
              />
            </RoundedBox>
          ))}

          {/* Foil seam between the two flexible pouch cells */}
          <mesh position={[0, safeHeight * 0.448, 0]}>
            <boxGeometry
              args={[safeLength * 0.018, safeHeight * 0.035, safeWidth * 0.94]}
            />
            <meshStandardMaterial
              color="#8f552e"
              metalness={0.12}
              roughness={0.62}
            />
          </mesh>

          {/* Two nylon straps */}
          {[-1, 1].map((side) => (
            <group key={side}>
              <mesh
                position={[side * safeLength * 0.31, safeHeight * 0.455, 0]}
                castShadow
              >
                <boxGeometry
                  args={[
                    safeLength * 0.055,
                    safeHeight * 0.035,
                    safeWidth * 0.98,
                  ]}
                />
                <meshStandardMaterial
                  color={strapColor}
                  roughness={0.95}
                />
              </mesh>

              <RoundedBox
                args={[
                  safeLength * 0.075,
                  safeHeight * 0.012,
                  safeWidth * 0.09,
                ]}
                position={[
                  side * safeLength * 0.31,
                  safeHeight * 0.478,
                  0,
                ]}
                radius={minDimension * 0.01}
                smoothness={3}
              >
                <meshStandardMaterial
                  color="#8d969f"
                  metalness={0.85}
                  roughness={0.28}
                />
              </RoundedBox>
            </group>
          ))}

          <BatteryLabel
            length={safeLength}
            height={safeHeight}
            width={safeWidth}
            label={label}
            specs={specs || "SOFT POUCH CELL"}
            surfaceY={safeHeight * 0.455}
            badgeLengthRatio={0.46}
            badgeWidthRatio={0.42}
          />
        </group>
      )}

      {/* ================================================= */}
      {/* 2. HARDCASE - 3S RC BATTERY                        */}
      {/* ================================================= */}

      {batteryDesign === "hardcase-3s" && (
        <group>
          {/* Main molded plastic enclosure */}
          <RoundedBox
            args={[safeLength, safeHeight * 0.94, safeWidth]}
            position={[0, 0, 0]}
            radius={minDimension * 0.035}
            smoothness={3}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#303945"
              metalness={0.38}
              roughness={0.3}
              emissive={selected ? "#b7791f" : "#000000"}
              emissiveIntensity={selected ? 0.07 : 0}
            />
          </RoundedBox>

          {/* Molded lower shell */}
          <RoundedBox
            args={[safeLength * 0.97, safeHeight * 0.19, safeWidth * 0.98]}
            position={[0, -safeHeight * 0.34, 0]}
            radius={minDimension * 0.045}
            smoothness={4}
          >
            <meshStandardMaterial
              color="#202832"
              metalness={0.3}
              roughness={0.42}
            />
          </RoundedBox>

          {/* Horizontal case separation line */}
          <mesh position={[0, -safeHeight * 0.20, 0]}>
            <boxGeometry
              args={[safeLength * 0.94, safeHeight * 0.012, safeWidth * 0.96]}
            />
            <meshStandardMaterial
              color="#10161e"
              roughness={0.7}
            />
          </mesh>

          {/* Reinforced end caps */}
          {[-1, 1].map((side) => (
            <RoundedBox
              key={side}
              args={[
                safeLength * 0.075,
                safeHeight * 0.77,
                safeWidth * 1.015,
              ]}
              position={[side * safeLength * 0.455, 0, 0]}
              radius={minDimension * 0.035}
              smoothness={4}
            >
              <meshStandardMaterial
                color="#171e27"
                metalness={0.42}
                roughness={0.32}
              />
            </RoundedBox>
          ))}

          {/* Three raised molded ribs */}
          {[-1, 0, 1].map((side) => (
            <RoundedBox
              key={side}
              args={[
                safeLength * 0.035,
                safeHeight * 0.66,
                safeWidth * 0.025,
              ]}
              position={[side * safeLength * 0.28, 0, safeWidth * 0.493]}
              radius={minDimension * 0.012}
              smoothness={3}
            >
              <meshStandardMaterial
                color="#68727e"
                metalness={0.48}
                roughness={0.36}
              />
            </RoundedBox>
          ))}

          {/* Four case screws */}
          {[-1, 1].map((x) =>
            [-1, 1].map((z) => (
              <Screw
                key={`${x}-${z}`}
                position={[
                  x * safeLength * 0.41,
                  safeHeight * 0.47,
                  z * safeWidth * 0.39,
                ]}
                scale={minDimension * 0.023}
              />
            ))
          )}

          {/* Top label */}
          <BatteryLabel
            length={safeLength}
            height={safeHeight}
            width={safeWidth}
            label={label}
            specs={specs || "HARDCASE POWER"}
            surfaceY={safeHeight * 0.455}
            badgeLengthRatio={0.58}
            badgeWidthRatio={0.52}
          />

          {/* Recessed cooling / grip grooves */}
          {[-1, 0, 1].map((side) => (
            <mesh
              key={side}
              position={[
                -safeLength * 0.12,
                safeHeight * 0.18,
                side * safeWidth * 0.498,
              ]}
            >
              <boxGeometry
                args={[
                  safeLength * 0.22,
                  safeHeight * 0.025,
                  safeWidth * 0.009,
                ]}
              />
              <meshStandardMaterial color="#111820" />
            </mesh>
          ))}
        </group>
      )}

      {/* ================================================= */}
      {/* 3. DRONE PACK - 6S HIGH CAPACITY                   */}
      {/* ================================================= */}

      {batteryDesign === "drone-6s" && (
        <group>
          {/* Elongated high-capacity pouch */}
          <RoundedBox
            args={[
              safeLength,
              safeHeight * 0.82,
              safeWidth,
            ]}
            position={[0, 0, 0]}
            radius={minDimension * 0.105}
            smoothness={8}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={color}
              metalness={0.09}
              roughness={0.32}
              emissive={selected ? "#b7791f" : "#000000"}
              emissiveIntensity={selected ? 0.07 : 0}
            />
          </RoundedBox>

          {/* Six separate cell caps form the elongated drone-pack silhouette */}
          {Array.from({ length: 6 }, (_, index) => {
            const cellX =
              -safeLength * 0.40 + index * safeLength * 0.16;

            return (
              <RoundedBox
                key={index}
                args={[
                  safeLength * 0.145,
                  safeHeight * 0.08,
                  safeWidth * 0.72,
                ]}
                position={[cellX, safeHeight * 0.42, 0]}
                radius={minDimension * 0.05}
                smoothness={6}
                castShadow
              >
                <meshStandardMaterial
                  color={color}
                  metalness={0.07}
                  roughness={0.31}
                />
              </RoundedBox>
            );
          })}

          {/* Outer compression bands */}
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * safeLength * 0.35, safeHeight * 0.475, 0]}
              castShadow
            >
              <boxGeometry
                args={[
                  safeLength * 0.045,
                  safeHeight * 0.04,
                  safeWidth * 1.01,
                ]}
              />
              <meshStandardMaterial
                color="#171e28"
                roughness={0.88}
              />
            </mesh>
          ))}

          {/* Top protection plate */}
          <RoundedBox
            args={[
              safeLength * 0.88,
              safeHeight * 0.035,
              safeWidth * 0.86,
            ]}
            position={[0, safeHeight * 0.41, 0]}
            radius={minDimension * 0.035}
            smoothness={4}
          >
            <meshStandardMaterial
              color="#222c38"
              metalness={0.25}
              roughness={0.42}
            />
          </RoundedBox>

          {/* Reinforced terminal end */}
          <RoundedBox
            args={[
              safeLength * 0.075,
              safeHeight * 0.45,
              safeWidth * 0.92,
            ]}
            position={[safeLength * 0.45, safeHeight * 0.015, 0]}
            radius={minDimension * 0.045}
            smoothness={4}
          >
            <meshStandardMaterial
              color="#151d28"
              metalness={0.3}
              roughness={0.4}
            />
          </RoundedBox>

          <BatteryLabel
            length={safeLength}
            height={safeHeight}
            width={safeWidth}
            label={label}
            specs={specs || "HIGH DISCHARGE PACK"}
            surfaceY={safeHeight * 0.455}
            badgeLengthRatio={0.4}
            badgeWidthRatio={0.38}
          />
        </group>
      )}

      {/* ================================================= */}
      {/* COMMON SELECTION OUTLINE                          */}
      {/* ================================================= */}

      {selected && (
        <RoundedBox
          args={[
            safeLength * 1.012,
            safeHeight * 1.012,
            safeWidth * 1.012,
          ]}
          radius={minDimension * 0.11}
          smoothness={5}
        >
          <meshBasicMaterial
            color="#fbbf24"
            wireframe
            transparent
            opacity={0.18}
          />
        </RoundedBox>
      )}

      {/* ================================================= */}
      {/* POWER CABLES                                      */}
      {/* ================================================= */}

      <mesh castShadow>
        <tubeGeometry args={[redWire, 40, wireRadius, 10, false]} />
        <meshStandardMaterial
          color="#e52c2c"
          roughness={0.36}
        />
      </mesh>

      <mesh castShadow>
        <tubeGeometry args={[blackWire, 40, wireRadius, 10, false]} />
        <meshStandardMaterial
          color="#111820"
          roughness={0.4}
        />
      </mesh>

      {/* ================================================= */}
      {/* XT60 CONNECTOR                                    */}
      {/* ================================================= */}

      <group
        position={[
          safeLength * 0.78,
          safeHeight * 0.12,
          0,
        ]}
      >
        {/* Connector housing */}
        <RoundedBox
          args={[
            safeLength * 0.15,
            safeHeight * 0.25,
            safeWidth * 0.34,
          ]}
          radius={minDimension * 0.07}
          smoothness={5}
          castShadow
        >
          <meshStandardMaterial
            color="#f3bd16"
            metalness={0.12}
            roughness={0.32}
          />
        </RoundedBox>

        {/* Front face */}
        <RoundedBox
          args={[
            safeLength * 0.018,
            safeHeight * 0.19,
            safeWidth * 0.30,
          ]}
          position={[safeLength * 0.085, 0, 0]}
          radius={minDimension * 0.035}
          smoothness={4}
        >
          <meshStandardMaterial
            color="#c99408"
            roughness={0.38}
          />
        </RoundedBox>

        {/* Two metal terminal sockets */}
        {[-1, 1].map((side) => (
          <group
            key={side}
            position={[
              safeLength * 0.10,
              0,
              side * safeWidth * 0.075,
            ]}
          >
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry
                args={[
                  minDimension * 0.052,
                  minDimension * 0.052,
                  safeLength * 0.012,
                  20,
                ]}
              />
              <meshStandardMaterial
                color="#c0a66c"
                metalness={0.92}
                roughness={0.22}
              />
            </mesh>

            <mesh
              position={[safeLength * 0.008, 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry
                args={[
                  minDimension * 0.033,
                  minDimension * 0.033,
                  safeLength * 0.01,
                  20,
                ]}
              />
              <meshStandardMaterial
                color="#171e28"
                metalness={0.65}
                roughness={0.3}
              />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
