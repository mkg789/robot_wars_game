import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type ControllerVariant = "arduino-uno" | "esp32" | "stm32-nucleo";

type ControllerModelProps = {
  size: [number, number, number];
  color?: string;
  selected?: boolean;
  variant?: ControllerVariant;
};

function createBoardTexture(variant: ControllerVariant): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, 512, 512);

  if (variant === "arduino-uno") {
    // Subtle copper trace lines under solder mask
    ctx.strokeStyle = "rgba(18, 178, 184, 0.45)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(140 + i * 26, 70);
      ctx.lineTo(140 + i * 26, 220);
      ctx.lineTo(180 + i * 24, 280);
      ctx.stroke();
    }

    // White silkscreen branding
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 10;

    // Infinity logo (two circles)
    ctx.beginPath();
    ctx.arc(230, 180, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(282, 180, 26, 0, Math.PI * 2);
    ctx.stroke();

    // Plus & minus inside infinity logo
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("-", 230, 181);
    ctx.fillText("+", 282, 181);

    // UNO badge & ARDUINO text
    ctx.fillRect(322, 162, 74, 34);
    ctx.fillStyle = "#00878f";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("UNO", 359, 180);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("ARDUINO", 256, 228);

    // Pin header labels
    ctx.font = "bold 14px monospace";
    ctx.fillText("DIGITAL (PWM~)", 290, 96);
    ctx.fillText("POWER", 220, 420);
    ctx.fillText("ANALOG IN", 355, 420);
  } else if (variant === "esp32") {
    // Top gold meander PCB antenna
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(150, 62);
    for (let x = 150; x <= 350; x += 28) {
      ctx.lineTo(x, 22);
      ctx.lineTo(x + 14, 22);
      ctx.lineTo(x + 14, 62);
    }
    ctx.stroke();

    // Pin silkscreen ticks on left and right
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    for (let i = 0; i < 15; i++) {
      const y = 70 + i * 26;
      ctx.fillText(`G${i}`, 68, y);
    }
    ctx.textAlign = "right";
    for (let i = 0; i < 15; i++) {
      const y = 70 + i * 26;
      ctx.fillText(`D${i}`, 444, y);
    }

    // EN / BOOT labels near bottom buttons
    ctx.textAlign = "center";
    ctx.font = "bold 14px monospace";
    ctx.fillText("EN", 150, 442);
    ctx.fillText("BOOT", 362, 442);
  } else if (variant === "stm32-nucleo") {
    // Light blue technical silkscreen
    ctx.fillStyle = "#2b7de9";
    ctx.strokeStyle = "#2b7de9";

    // Perforation divider line between ST-LINK and Target sections
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, 155);
    ctx.lineTo(492, 155);
    ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Nucleo", 26, 95);
    ctx.font = "bold 14px monospace";
    ctx.fillText("MB1136", 88, 195);
    ctx.fillText("rev C", 88, 212);

    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.fillText("USER", 190, 185);
    ctx.fillText("RESET", 330, 185);

    // Bottom ST logo & URL
    ctx.font = "italic bold 42px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("ST", 412, 456);

    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("www.st.com/stm32nucleo", 225, 480);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function createEspShieldTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#b8bec5";
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = "#8a929a";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 240, 240);

  ctx.fillStyle = "#3f464e";
  ctx.font = "bold 28px monospace";
  ctx.textAlign = "center";
  ctx.fillText("ESP-32", 128, 72);

  ctx.font = "15px monospace";
  ctx.fillText("Wi-Fi + BT", 128, 108);
  ctx.fillText("FCC ID: 2AC7Z", 128, 134);

  // Stylized QR code block
  ctx.fillStyle = "#2b3036";
  ctx.fillRect(148, 154, 62, 62);
  ctx.fillStyle = "#b8bec5";
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if ((r + c) % 2 === 0) {
        ctx.fillRect(154 + c * 10, 160 + r * 10, 8, 8);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export default function ControllerModel({
  size,
  color,
  selected = false,
  variant = "arduino-uno",
}: ControllerModelProps) {
  const [length, height, width] = size;
  const boardThickness = Math.max(height * 0.14, 0.0015);
  const boardY = -height * 0.34;
  const boardTop = boardY + boardThickness * 0.5;
  const silkscreenY = boardTop + Math.max(height * 0.006, 0.00025);

  const boardTexture = useMemo(() => createBoardTexture(variant), [variant]);
  const espShieldTexture = useMemo(
    () => (variant === "esp32" ? createEspShieldTexture() : null),
    [variant]
  );

  const activeTexturesRef = useRef<{
    board: THREE.CanvasTexture | null;
    espShield: THREE.CanvasTexture | null;
  }>({ board: null, espShield: null });

  // Defer disposal via microtask so React StrictMode double-mount preserves memoized textures
  useEffect(() => {
    activeTexturesRef.current = {
      board: boardTexture,
      espShield: espShieldTexture,
    };
    return () => {
      activeTexturesRef.current = { board: null, espShield: null };
      Promise.resolve().then(() => {
        if (boardTexture && activeTexturesRef.current.board !== boardTexture) {
          boardTexture.dispose();
        }
        if (
          espShieldTexture &&
          activeTexturesRef.current.espShield !== espShieldTexture
        ) {
          espShieldTexture.dispose();
        }
      });
    };
  }, [boardTexture, espShieldTexture]);

  const defaultPcbColor =
    variant === "arduino-uno"
      ? "#00878f"
      : variant === "esp32"
        ? "#16191f"
        : "#f0f3f7";

  const pcbColor = color && variant === "arduino-uno" && color !== "#00878f"
    ? defaultPcbColor
    : defaultPcbColor;

  return (
    <group>
      {/* ===================== ARDUINO UNO ===================== */}
      {variant === "arduino-uno" && (
        <group>
          {/* Main Teal PCB */}
          <mesh position={[0, boardY, 0]} castShadow receiveShadow>
            <boxGeometry args={[length * 0.96, boardThickness, width * 0.96]} />
            <meshStandardMaterial color={pcbColor} metalness={0.12} roughness={0.42} />
          </mesh>

          {/* Silkscreen Layer */}
          {boardTexture && (
            <mesh position={[0, silkscreenY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[length * 0.94, width * 0.94]} />
              <meshBasicMaterial
                map={boardTexture}
                transparent
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-1}
              />
            </mesh>
          )}

          {/* USB-B Silver Metal Port (top-left, protruding past edge) */}
          <mesh
            position={[-length * 0.44, boardTop + height * 0.28, -width * 0.16]}
            castShadow
          >
            <boxGeometry args={[length * 0.22, height * 0.56, width * 0.23]} />
            <meshStandardMaterial color="#cfd6dc" metalness={0.86} roughness={0.22} />
          </mesh>

          {/* DC Barrel Jack (bottom-left) */}
          <mesh
            position={[-length * 0.42, boardTop + height * 0.25, width * 0.34]}
            castShadow
          >
            <boxGeometry args={[length * 0.2, height * 0.5, width * 0.17]} />
            <meshStandardMaterial color="#181b20" metalness={0.18} roughness={0.5} />
          </mesh>

          {/* Reset Tactile Button (top-left corner) */}
          <group position={[-length * 0.4, boardTop, -width * 0.4]}>
            <mesh position={[0, height * 0.06, 0]} castShadow>
              <boxGeometry args={[length * 0.07, height * 0.12, width * 0.08]} />
              <meshStandardMaterial color="#c4ccd4" metalness={0.75} roughness={0.3} />
            </mesh>
            <mesh position={[0, height * 0.13, 0]} castShadow>
              <cylinderGeometry args={[length * 0.018, length * 0.018, height * 0.06, 12]} />
              <meshStandardMaterial color="#e5e7eb" metalness={0.1} roughness={0.45} />
            </mesh>
          </group>

          {/* ATmega328P DIP-28 Microcontroller (lower-right) */}
          <group position={[length * 0.14, boardTop, width * 0.17]}>
            {/* IC Socket */}
            <mesh position={[0, height * 0.08, 0]} castShadow>
              <boxGeometry args={[length * 0.48, height * 0.16, width * 0.17]} />
              <meshStandardMaterial color="#23272e" metalness={0.2} roughness={0.55} />
            </mesh>
            {/* DIP Chip Body */}
            <mesh position={[0, height * 0.18, 0]} castShadow>
              <boxGeometry args={[length * 0.45, height * 0.1, width * 0.14]} />
              <meshStandardMaterial color="#14171c" metalness={0.25} roughness={0.4} />
            </mesh>
          </group>

          {/* Two Silver Electrolytic Capacitors near Barrel Jack */}
          {[-0.22, -0.12].map((xRatio, idx) => (
            <mesh
              key={`uno-cap-${idx}`}
              position={[length * xRatio, boardTop + height * 0.16, width * 0.31]}
              castShadow
            >
              <cylinderGeometry args={[width * 0.06, width * 0.06, height * 0.32, 16]} />
              <meshStandardMaterial color="#d2d8de" metalness={0.85} roughness={0.22} />
            </mesh>
          ))}

          {/* 16MHz Crystal Oscillator */}
          <mesh
            position={[-length * 0.22, boardTop + height * 0.08, -width * 0.02]}
            castShadow
          >
            <boxGeometry args={[length * 0.13, height * 0.16, width * 0.08]} />
            <meshStandardMaterial color="#dce2e8" metalness={0.9} roughness={0.18} />
          </mesh>

          {/* Top Digital Female Header Strips (-Z) */}
          <mesh position={[-length * 0.06, boardTop + height * 0.22, -width * 0.43]} castShadow>
            <boxGeometry args={[length * 0.36, height * 0.44, width * 0.055]} />
            <meshStandardMaterial color="#181b20" metalness={0.15} roughness={0.55} />
          </mesh>
          <mesh position={[length * 0.29, boardTop + height * 0.22, -width * 0.43]} castShadow>
            <boxGeometry args={[length * 0.28, height * 0.44, width * 0.055]} />
            <meshStandardMaterial color="#181b20" metalness={0.15} roughness={0.55} />
          </mesh>

          {/* Bottom Power & Analog Female Header Strips (+Z) */}
          <mesh position={[length * 0.06, boardTop + height * 0.22, width * 0.43]} castShadow>
            <boxGeometry args={[length * 0.28, height * 0.44, width * 0.055]} />
            <meshStandardMaterial color="#181b20" metalness={0.15} roughness={0.55} />
          </mesh>
          <mesh position={[length * 0.32, boardTop + height * 0.22, width * 0.43]} castShadow>
            <boxGeometry args={[length * 0.2, height * 0.44, width * 0.055]} />
            <meshStandardMaterial color="#181b20" metalness={0.15} roughness={0.55} />
          </mesh>

          {/* ICSP 2x3 Pin Header (right edge) */}
          <mesh position={[length * 0.42, boardTop + height * 0.14, width * 0.02]} castShadow>
            <boxGeometry args={[length * 0.06, height * 0.28, width * 0.12]} />
            <meshStandardMaterial color="#1d2126" metalness={0.2} roughness={0.5} />
          </mesh>
        </group>
      )}

      {/* ===================== ESP32 DEVKIT ===================== */}
      {variant === "esp32" && (
        <group>
          {/* Matte Black PCB */}
          <mesh position={[0, boardY, 0]} castShadow receiveShadow>
            <boxGeometry args={[length * 0.96, boardThickness, width * 0.96]} />
            <meshStandardMaterial color={pcbColor} metalness={0.18} roughness={0.52} />
          </mesh>

          {/* Silkscreen + Gold PCB Antenna */}
          {boardTexture && (
            <mesh position={[0, silkscreenY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[length * 0.94, width * 0.94]} />
              <meshBasicMaterial
                map={boardTexture}
                transparent
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-1}
              />
            </mesh>
          )}

          {/* ESP-WROOM-32 Brushed Metal RF Shield */}
          <group position={[0, boardTop, -width * 0.11]}>
            <mesh position={[0, height * 0.16, 0]} castShadow>
              <boxGeometry args={[length * 0.62, height * 0.32, width * 0.38]} />
              <meshStandardMaterial color="#bfc6cd" metalness={0.82} roughness={0.26} />
            </mesh>
            {espShieldTexture && (
              <mesh
                position={[0, height * 0.323, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <planeGeometry args={[length * 0.6, width * 0.36]} />
                <meshBasicMaterial map={espShieldTexture} />
              </mesh>
            )}
          </group>

          {/* USB-to-UART Chip (CP2102) & Voltage Regulator */}
          <mesh position={[length * 0.14, boardTop + height * 0.06, width * 0.24]} castShadow>
            <boxGeometry args={[length * 0.18, height * 0.12, width * 0.1]} />
            <meshStandardMaterial color="#1e2228" metalness={0.3} roughness={0.42} />
          </mesh>
          <mesh position={[-length * 0.16, boardTop + height * 0.07, width * 0.22]} castShadow>
            <boxGeometry args={[length * 0.16, height * 0.14, width * 0.08]} />
            <meshStandardMaterial color="#252930" metalness={0.28} roughness={0.45} />
          </mesh>

          {/* Micro-USB Port (bottom center) */}
          <mesh position={[0, boardTop + height * 0.14, width * 0.46]} castShadow>
            <boxGeometry args={[length * 0.26, height * 0.28, width * 0.12]} />
            <meshStandardMaterial color="#d4dae0" metalness={0.88} roughness={0.2} />
          </mesh>

          {/* EN & BOOT Tactile Buttons */}
          {[-0.26, 0.26].map((xRatio, idx) => (
            <group
              key={`esp-btn-${idx}`}
              position={[length * xRatio, boardTop, width * 0.42]}
            >
              <mesh position={[0, height * 0.06, 0]} castShadow>
                <boxGeometry args={[length * 0.11, height * 0.12, width * 0.06]} />
                <meshStandardMaterial color="#c4ccd4" metalness={0.75} roughness={0.3} />
              </mesh>
              <mesh position={[0, height * 0.13, 0]} castShadow>
                <cylinderGeometry args={[length * 0.03, length * 0.03, height * 0.05, 10]} />
                <meshStandardMaterial color="#14171c" metalness={0.2} roughness={0.5} />
              </mesh>
            </group>
          ))}

          {/* Left & Right Header Pin Rows (15 pins per side) */}
          {[-1, 1].flatMap((side) =>
            Array.from({ length: 15 }, (_, i) => {
              const z = -width * 0.38 + (width * 0.76 * i) / 14;
              return (
                <group
                  key={`esp-pin-${side}-${i}`}
                  position={[side * length * 0.43, boardTop, z]}
                >
                  <mesh position={[0, height * 0.06, 0]} castShadow>
                    <boxGeometry args={[length * 0.07, height * 0.12, width * 0.035]} />
                    <meshStandardMaterial color="#1c2026" metalness={0.15} roughness={0.6} />
                  </mesh>
                  <mesh position={[0, height * 0.14, 0]} castShadow>
                    <cylinderGeometry args={[length * 0.014, length * 0.014, height * 0.14, 6]} />
                    <meshStandardMaterial color="#d8c078" metalness={0.85} roughness={0.24} />
                  </mesh>
                </group>
              );
            })
          )}
        </group>
      )}

      {/* ===================== STM32 NUCLEO-64 ===================== */}
      {variant === "stm32-nucleo" && (
        <group>
          {/* Crisp White PCB (Upper ST-LINK + Lower Target) */}
          <mesh position={[0, boardY, 0]} castShadow receiveShadow>
            <boxGeometry args={[length * 0.96, boardThickness, width * 0.96]} />
            <meshStandardMaterial color={pcbColor} metalness={0.08} roughness={0.38} />
          </mesh>

          {/* Silkscreen Layer (ST logo, MB1136, divider) */}
          {boardTexture && (
            <mesh position={[0, silkscreenY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[length * 0.94, width * 0.94]} />
              <meshBasicMaterial
                map={boardTexture}
                transparent
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-1}
              />
            </mesh>
          )}

          {/* Mini-USB Port (top center) */}
          <mesh position={[length * 0.1, boardTop + height * 0.2, -width * 0.45]} castShadow>
            <boxGeometry args={[length * 0.14, height * 0.4, width * 0.12]} />
            <meshStandardMaterial color="#c9b48a" metalness={0.82} roughness={0.28} />
          </mesh>

          {/* Upper ST-LINK MCU + Crystal */}
          <mesh position={[0, boardTop + height * 0.07, -width * 0.32]} castShadow>
            <boxGeometry args={[length * 0.14, height * 0.14, width * 0.11]} />
            <meshStandardMaterial color="#252930" metalness={0.3} roughness={0.42} />
          </mesh>
          <mesh position={[-length * 0.17, boardTop + height * 0.09, -width * 0.32]} castShadow>
            <boxGeometry args={[length * 0.06, height * 0.18, width * 0.11]} />
            <meshStandardMaterial color="#d4dce3" metalness={0.88} roughness={0.2} />
          </mesh>

          {/* Blue USER Button (B1) */}
          <group position={[-length * 0.12, boardTop, -width * 0.08]}>
            <mesh position={[0, height * 0.12, 0]} castShadow>
              <boxGeometry args={[length * 0.1, height * 0.24, width * 0.08]} />
              <meshStandardMaterial color="#e5e9ef" metalness={0.15} roughness={0.4} />
            </mesh>
            <mesh position={[0, height * 0.26, 0]} castShadow>
              <cylinderGeometry args={[length * 0.036, length * 0.036, height * 0.12, 16]} />
              <meshStandardMaterial color="#1d6fe2" metalness={0.12} roughness={0.35} />
            </mesh>
          </group>

          {/* Black RESET Button (B2) */}
          <group position={[length * 0.14, boardTop, -width * 0.08]}>
            <mesh position={[0, height * 0.12, 0]} castShadow>
              <boxGeometry args={[length * 0.1, height * 0.24, width * 0.08]} />
              <meshStandardMaterial color="#2c3138" metalness={0.2} roughness={0.45} />
            </mesh>
            <mesh position={[0, height * 0.26, 0]} castShadow>
              <cylinderGeometry args={[length * 0.034, length * 0.034, height * 0.12, 16]} />
              <meshStandardMaterial color="#14171c" metalness={0.15} roughness={0.42} />
            </mesh>
          </group>

          {/* Main STM32 LQFP-64 Microcontroller (lower center) */}
          <group position={[-length * 0.02, boardTop, width * 0.21]}>
            <mesh position={[0, height * 0.06, 0]} castShadow>
              <boxGeometry args={[length * 0.18, height * 0.12, width * 0.15]} />
              <meshStandardMaterial color="#2b3038" metalness={0.32} roughness={0.4} />
            </mesh>
            {/* Silver pin skirts */}
            <mesh position={[0, height * 0.03, 0]}>
              <boxGeometry args={[length * 0.21, height * 0.04, width * 0.13]} />
              <meshStandardMaterial color="#cfd6dd" metalness={0.85} roughness={0.25} />
            </mesh>
            <mesh position={[0, height * 0.03, 0]}>
              <boxGeometry args={[length * 0.16, height * 0.04, width * 0.18]} />
              <meshStandardMaterial color="#cfd6dd" metalness={0.85} roughness={0.25} />
            </mesh>
          </group>

          {/* Outer Double-Row ST Morpho Headers (Left & Right) */}
          {[-1, 1].map((side) => (
            <mesh
              key={`morpho-${side}`}
              position={[side * length * 0.42, boardTop + height * 0.22, width * 0.18]}
              castShadow
            >
              <boxGeometry args={[length * 0.075, height * 0.44, width * 0.56]} />
              <meshStandardMaterial color="#171a20" metalness={0.15} roughness={0.55} />
            </mesh>
          ))}

          {/* Inner Arduino-Compatible Female Headers (Left & Right) */}
          {[-1, 1].map((side) => (
            <mesh
              key={`nucleo-arduino-hdr-${side}`}
              position={[side * length * 0.31, boardTop + height * 0.22, width * 0.2]}
              castShadow
            >
              <boxGeometry args={[length * 0.045, height * 0.44, width * 0.46]} />
              <meshStandardMaterial color="#1e2228" metalness={0.15} roughness={0.55} />
            </mesh>
          ))}

          {/* Upper Left SWD Pin Header */}
          <mesh position={[-length * 0.37, boardTop + height * 0.18, -width * 0.34]} castShadow>
            <boxGeometry args={[length * 0.06, height * 0.36, width * 0.2]} />
            <meshStandardMaterial color="#1a1d24" metalness={0.18} roughness={0.55} />
          </mesh>
        </group>
      )}

      {/* Selection Wireframe */}
      {selected && (
        <mesh>
          <boxGeometry args={[length * 1.04, height * 1.08, width * 1.04]} />
          <meshBasicMaterial
            color="#fbbf24"
            wireframe
            transparent
            opacity={0.85}
          />
        </mesh>
      )}
    </group>
  );
}