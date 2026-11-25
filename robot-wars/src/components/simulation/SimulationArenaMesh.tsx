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
      ? "#334155"
      : "#475569";

  return (
    <mesh
      position={[barrier.position.x, height / 2, barrier.position.z]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[barrier.sizeX, height, barrier.sizeZ]} />
      <meshStandardMaterial
        color={baseColor}
        emissive={isCollided ? "#dc2626" : "#000000"}
        emissiveIntensity={isCollided ? 0.55 : 0}
        metalness={isPerimeter ? 0.65 : 0.45}
        roughness={isPerimeter ? 0.45 : 0.5}
      />
    </mesh>
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
        return (
          <mesh key={zone.id} position={[zoneX, 0.004, zoneZ]} receiveShadow>
            <boxGeometry args={[sizeX, 0.008, sizeZ]} />
            <meshStandardMaterial
              color={getZoneColor(zone.surface)}
              transparent
              opacity={0.34}
              roughness={0.35}
              metalness={0.1}
            />
          </mesh>
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
