import { Grid } from "@react-three/drei";
import type { ArenaBarrier, ArenaConfig } from "../../features/simulation/types/arena.types";
import { resolveSurfaceAtPoint } from "../../features/simulation/logic/arenaModel";

interface SimulationArenaMeshProps {
  readonly arena: ArenaConfig;
  readonly collidedBarrierIds: readonly string[];
}

function getZoneColor(surfaceRef: ArenaConfig["surfaceZones"][number]["surface"]): string {
  const id = typeof surfaceRef === "string" ? surfaceRef : surfaceRef.id;
  switch (id) {
    case "low-grip":
      return "#38bdf8";
    case "rubber-high-grip":
      return "#22c55e";
    case "wood":
      return "#b45309";
    case "asphalt":
      return "#334155";
    case "concrete":
      return "#64748b";
    default:
      return "#475569";
  }
}

function BarrierMesh({
  barrier,
  defaultHeight,
  isCollided,
}: {
  readonly barrier: ArenaBarrier;
  readonly defaultHeight: number;
  readonly isCollided: boolean;
}) {
  const height = barrier.heightM ?? defaultHeight;
  const isPerimeter = Boolean(barrier.isPerimeter);

  const baseColor = isCollided
    ? "#ef4444"
    : isPerimeter
      ? "#2b3749"
      : "#5b6d82";

  return (
    <group
      position={[barrier.position.x, height / 2, barrier.position.z]}
      rotation={[0, -(barrier.rotationRadians ?? 0), 0]}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[barrier.sizeX, height, barrier.sizeZ]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={isCollided ? "#dc2626" : "#000000"}
          emissiveIntensity={isCollided ? 0.55 : 0}
          metalness={isPerimeter ? 0.65 : 0.45}
          roughness={isPerimeter ? 0.48 : 0.45}
        />
      </mesh>
      {/* Top hazard cap on interior barriers to distinguish obstacles from perimeter walls */}
      {!isPerimeter && (
        <mesh position={[0, height / 2 + 0.01, 0]}>
          <boxGeometry args={[barrier.sizeX, 0.02, barrier.sizeZ]} />
          <meshStandardMaterial
            color={isCollided ? "#fca5a5" : "#d97706"}
            emissive={isCollided ? "#ef4444" : "#78350f"}
            emissiveIntensity={isCollided ? 0.45 : 0.2}
            roughness={0.4}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * Renders the simulation arena floor, spatial surface zones, perimeter walls,
 * and interior barriers directly from ArenaConfig canonical geometry.
 */
export default function SimulationArenaMesh({
  arena,
  collidedBarrierIds,
}: SimulationArenaMeshProps) {
  const centerX = (arena.bounds.minX + arena.bounds.maxX) / 2;
  const centerZ = (arena.bounds.minZ + arena.bounds.maxZ) / 2;
  const defaultWallHeight = arena.boundary.wallHeightM ?? 0.9;
  const collidedSet = new Set(collidedBarrierIds);

  const fallbackSurface = resolveSurfaceAtPoint(arena, centerX, centerZ);
  const floorColor =
    fallbackSurface.id === "low-grip"
      ? "#1e3a5f"
      : fallbackSurface.id === "wood"
        ? "#3f2e21"
        : "#1a2330";

  return (
    <group>
      {/* Arena Floor Plate */}
      <mesh
        position={[centerX, -0.02, centerZ]}
        receiveShadow
      >
        <boxGeometry
          args={[arena.dimensions.lengthM, 0.04, arena.dimensions.widthM]}
        />
        <meshStandardMaterial
          color={floorColor}
          metalness={0.22}
          roughness={0.82}
        />
      </mesh>

      {/* Subtle Arena Metric Grid */}
      <Grid
        position={[centerX, 0.002, centerZ]}
        args={[arena.dimensions.lengthM, arena.dimensions.widthM]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#2c3a4b"
        sectionSize={2}
        sectionThickness={0.9}
        sectionColor="#42546a"
        fadeDistance={40}
        fadeStrength={0.35}
      />

      {/* +X Forward Reference Strip on Arena Floor */}
      <mesh position={[arena.bounds.maxX - 0.35, 0.004, centerZ]}>
        <boxGeometry args={[0.12, 0.004, Math.min(2.0, arena.dimensions.widthM * 0.25)]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.6} />
      </mesh>

      {/* Spatial Surface Zones */}
      {arena.surfaceZones.map((zone) => {
        const sizeX = zone.bounds.maxX - zone.bounds.minX;
        const sizeZ = zone.bounds.maxZ - zone.bounds.minZ;
        const zoneX = (zone.bounds.minX + zone.bounds.maxX) / 2;
        const zoneZ = (zone.bounds.minZ + zone.bounds.maxZ) / 2;
        const zoneColor = getZoneColor(zone.surface);
        const borderThickness = 0.04;
        return (
          <group key={zone.id} position={[zoneX, 0.004, zoneZ]}>
            <mesh receiveShadow>
              <boxGeometry args={[sizeX, 0.006, sizeZ]} />
              <meshStandardMaterial
                color={zoneColor}
                transparent
                opacity={0.3}
                roughness={0.35}
                metalness={0.1}
              />
            </mesh>
            {/* Subtle zone perimeter border for clear surface boundary visibility */}
            <mesh position={[sizeX / 2, 0.004, 0]}>
              <boxGeometry args={[borderThickness, 0.004, sizeZ]} />
              <meshBasicMaterial color={zoneColor} />
            </mesh>
            <mesh position={[-sizeX / 2, 0.004, 0]}>
              <boxGeometry args={[borderThickness, 0.004, sizeZ]} />
              <meshBasicMaterial color={zoneColor} />
            </mesh>
            <mesh position={[0, 0.004, sizeZ / 2]}>
              <boxGeometry args={[sizeX, 0.004, borderThickness]} />
              <meshBasicMaterial color={zoneColor} />
            </mesh>
            <mesh position={[0, 0.004, -sizeZ / 2]}>
              <boxGeometry args={[sizeX, 0.004, borderThickness]} />
              <meshBasicMaterial color={zoneColor} />
            </mesh>
          </group>
        );
      })}

      {/* Perimeter Walls */}
      {arena.boundary.perimeterWalls.map((wall) => (
        <BarrierMesh
          key={wall.id}
          barrier={wall}
          defaultHeight={defaultWallHeight}
          isCollided={collidedSet.has(wall.id)}
        />
      ))}

      {/* Interior Barriers */}
      {arena.barriers.map((barrier) => (
        <BarrierMesh
          key={barrier.id}
          barrier={barrier}
          defaultHeight={defaultWallHeight}
          isCollided={collidedSet.has(barrier.id)}
        />
      ))}
    </group>
  );
}
