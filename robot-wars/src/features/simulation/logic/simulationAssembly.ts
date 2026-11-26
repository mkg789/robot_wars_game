import { batteryCatalogue } from "../../robot-builder/data/batteryCatalogue";
import { controllerCatalogue } from "../../robot-builder/data/controllerCatalogue";
import { wheelCatalogue } from "../../robot-builder/data/wheelCatalogue";
import {
  getPartBoxExtents,
  getPartCylinderDimensions,
} from "../../robot-builder/logic/geometryAdapters";
import type {
  DrivetrainConfiguration,
  DrivetrainSide,
  FoundationConfig,
  ImportedMeshTransform,
  MountingPatternConfig,
  RobotConnection,
  RobotPart,
  StructuralVisualShape,
  WheelDefinition,
} from "../../robot-builder/types/robot.types";
import type { ArenaConfig } from "../types/arena.types";
import type { SimulationRobotConfig } from "../types/simulation.types";
import {
  createRobotCollisionEnvelope,
  deriveRobotFootprintDimensions,
  detectArenaCollisions,
} from "./collisionModel";

export type BatteryVisualDesign = "soft-2s" | "hardcase-3s" | "drone-6s";
export type ControllerVisualVariant = "arduino-uno" | "esp32" | "stm32-nucleo";

export type AssemblyVisualPartKind =
  | "chassis"
  | "top-plate"
  | "motor"
  | "wheel"
  | "battery"
  | "controller"
  | "bumper"
  | "structural";

export interface ResolvedAssemblyVisualPart {
  readonly partId: string;
  readonly name: string;
  readonly type: RobotPart["type"];
  readonly kind: AssemblyVisualPartKind;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly color: string;
  readonly boxExtents: readonly [number, number, number];
  readonly cylinderDimensions: {
    readonly radius: number;
    readonly diameter: number;
    readonly width: number;
  };
  readonly drivetrainSide: DrivetrainSide | null;
  readonly axleSpinSign: 1 | -1;
  readonly wheelCategory: WheelDefinition["category"];
  readonly structuralVisualShape?: StructuralVisualShape;
  readonly meshAssetId?: string;
  readonly meshTransform?: ImportedMeshTransform;
  readonly mountingPatterns?: readonly MountingPatternConfig[];
  readonly hideSolidChassisShell?: boolean;
  readonly geometryShape?: "box" | "cylinder";
  readonly cylinderAxis?: "x" | "y" | "z";
  readonly batteryMeta?: {
    readonly design: BatteryVisualDesign;
    readonly typeLabel: string;
    readonly voltage?: number;
    readonly capacityMah?: number;
  };
  readonly controllerMeta?: {
    readonly color: string;
    readonly variant: ControllerVisualVariant;
  };
}

export interface AssemblyFootprintDimensions {
  readonly lengthM: number;
  readonly widthM: number;
}

export interface ResolvedAssemblyVisualSpec {
  readonly parts: readonly ResolvedAssemblyVisualPart[];
  readonly verticalOffsetY: number;
  readonly footprint: AssemblyFootprintDimensions;
  readonly leftWheelPartIds: readonly string[];
  readonly rightWheelPartIds: readonly string[];
  readonly motorCount: number;
  readonly wheelCount: number;
  readonly hasChassis: boolean;
}

export interface SimulationSpawnPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export type SimulationSpawnResolutionResult =
  | {
      readonly valid: true;
      readonly pose: SimulationSpawnPose;
      readonly adjustedFromPreferred: boolean;
    }
  | {
      readonly valid: false;
      readonly error: string;
    };

/**
 * Computes rotated AABB half-extents [hx, hy, hz] in robot local coordinates from
 * local half-extents and XYZ Euler angles matching Three.js's default Euler("XYZ") order.
 */
function computeRotatedHalfExtents(
  localHalfExtents: readonly [number, number, number],
  rotation: readonly [number, number, number]
): [number, number, number] {
  const [hx, hy, hz] = localHalfExtents;
  const [rx, ry, rz] = rotation;

  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  // R = Rx * Ry * Rz
  const ae = cx * cz;
  const af = cx * sz;
  const be = sx * cz;
  const bf = sx * sz;

  const r00 = cy * cz;
  const r01 = -cy * sz;
  const r02 = sy;

  const r10 = af + be * sy;
  const r11 = ae - bf * sy;
  const r12 = -sx * cy;

  const r20 = bf - ae * sy;
  const r21 = be + af * sy;
  const r22 = cx * cy;

  return [
    Math.abs(r00) * hx + Math.abs(r01) * hy + Math.abs(r02) * hz,
    Math.abs(r10) * hx + Math.abs(r11) * hy + Math.abs(r12) * hz,
    Math.abs(r20) * hx + Math.abs(r21) * hy + Math.abs(r22) * hz,
  ];
}

/**
 * Computes wheel local +X axle direction Z-component in robot frame after Euler XYZ rotation,
 * returning the rotation.x sign (+/-1) that corresponds to forward (+X) vehicle motion.
 */
export function computeWheelAxleSpinSign(
  rotation: readonly [number, number, number],
  fallbackSide?: DrivetrainSide | null
): 1 | -1 {
  const [rx, ry, rz] = rotation;
  // Local +X axis = (1, 0, 0) transformed by R = Rx * Ry * Rz:
  // z = (-sin(ry) * cos(rz)) * cos(rx) + (sin(rz)) * sin(rx)
  const axleZ =
    Math.sin(rx) * Math.sin(rz) - Math.cos(rx) * Math.sin(ry) * Math.cos(rz);

  if (Math.abs(axleZ) > 1e-6) {
    return axleZ > 0 ? -1 : 1;
  }
  if (fallbackSide === "left") {
    return -1;
  }
  return 1;
}

function classifyAssemblyPartKind(part: RobotPart): AssemblyVisualPartKind {
  if (part.id === "foundation-chassis") return "chassis";
  if (part.id === "foundation-top-plate") return "top-plate";
  if (part.type === "Motor") return "motor";
  if (part.type === "Wheel") return "wheel";
  if (part.type === "Battery") return "battery";
  if (part.type === "Controller") return "controller";
  if (part.type === "Front Bumper") return "bumper";
  return "structural";
}

function resolveBatteryMetadata(
  part: RobotPart
): ResolvedAssemblyVisualPart["batteryMeta"] {
  const batteryDef = batteryCatalogue.find(
    (entry) =>
      entry.id === part.batteryCatalogueId ||
      part.name.toLowerCase().includes(entry.name.toLowerCase())
  );

  const design: BatteryVisualDesign =
    part.batteryCatalogueId === "standard-lipo"
      ? "hardcase-3s"
      : part.batteryCatalogueId === "heavy-duty-lipo"
      ? "drone-6s"
      : "soft-2s";

  const typeLabel =
    design === "soft-2s"
      ? "SOFT POUCH"
      : design === "hardcase-3s"
      ? "HARDCASE"
      : "DRONE PACK";

  return {
    design,
    typeLabel,
    voltage: batteryDef?.voltage ?? part.electrical?.nominalVoltageV,
    capacityMah: batteryDef?.capacityMah ?? part.electrical?.capacityMah,
  };
}

function resolveControllerMetadata(
  part: RobotPart
): ResolvedAssemblyVisualPart["controllerMeta"] {
  const controllerDef = controllerCatalogue.find(
    (entry) =>
      entry.id === part.controllerCatalogueId ||
      part.name.toLowerCase().includes(entry.name.toLowerCase())
  );
  const lookup =
    `${part.controllerCatalogueId ?? ""} ${part.name}`.toLowerCase();

  const variant: ControllerVisualVariant = lookup.includes("esp")
    ? "esp32"
    : lookup.includes("stm") || lookup.includes("nucleo")
    ? "stm32-nucleo"
    : "arduino-uno";

  return {
    color: controllerDef?.color ?? part.color,
    variant,
  };
}

function resolveWheelCategory(part: RobotPart): WheelDefinition["category"] {
  return (
    wheelCatalogue.find((wheel) => wheel.id === part.wheelCatalogueId)
      ?.category ?? "Rubber"
  );
}

/**
 * Maps drivetrain assignments to wheel part IDs.
 * Explicit assignments in `drivetrain` take precedence; if no drivetrain is provided,
 * wheel side falls back cleanly to robot lateral coordinate (+Z left, -Z right).
 */
export function resolveDrivetrainWheelSideMap(
  parts: readonly RobotPart[],
  drivetrain: DrivetrainConfiguration | null | undefined,
  connections?: readonly RobotConnection[]
): ReadonlyMap<string, DrivetrainSide> {
  const sideMap = new Map<string, DrivetrainSide>();
  const validPartIds = new Set(parts.map((part) => part.id));
  const hasExplicitAssignments =
    drivetrain !== null &&
    drivetrain !== undefined &&
    (drivetrain.left.some((entry) => entry !== null) ||
      drivetrain.right.some((entry) => entry !== null));

  if (drivetrain) {
    for (const assignment of drivetrain.left) {
      if (assignment && validPartIds.has(assignment.wheelId)) {
        sideMap.set(assignment.wheelId, "left");
      }
    }
    for (const assignment of drivetrain.right) {
      if (assignment && validPartIds.has(assignment.wheelId)) {
        sideMap.set(assignment.wheelId, "right");
      }
    }
  }

  if (!hasExplicitAssignments) {
    const motorById = new Map(
      parts.filter((p) => p.type === "Motor").map((m) => [m.id, m])
    );
    const wheelToMotorZ = new Map<string, number>();

    if (connections) {
      for (const conn of connections) {
        if (conn.type !== "Motor-Wheel") continue;
        const motorId = motorById.has(conn.parentId)
          ? conn.parentId
          : motorById.has(conn.sourceId)
          ? conn.sourceId
          : undefined;
        const wheelId =
          conn.childId === motorId ? conn.parentId : conn.childId || conn.targetId;
        const motor = motorId ? motorById.get(motorId) : undefined;
        if (motor && validPartIds.has(wheelId)) {
          wheelToMotorZ.set(wheelId, motor.position[2]);
        }
      }
    }

    for (const part of parts) {
      if (part.type === "Wheel" && !sideMap.has(part.id)) {
        const refZ = wheelToMotorZ.get(part.id) ?? part.position[2];
        sideMap.set(part.id, refZ >= 0 ? "left" : "right");
      }
    }
  }

  return sideMap;
}

/**
 * Computes symmetric X-Z footprint bounds around the robot origin from all visible assembly parts.
 * Considers custom collision proxy envelopes when configured; SimulationWorld simulates one global
 * 2D planar OBB per robot, so multi-box internal gaps/concave pockets remain outer-envelope bounds.
 */
export function computeAssemblyFootprintDimensions(
  parts: readonly RobotPart[],
  fallback?: AssemblyFootprintDimensions
): AssemblyFootprintDimensions {
  let maxAbsX = 0;
  let maxAbsZ = 0;

  for (const part of parts) {
    const boxExtents = getPartBoxExtents(part);
    const cylinderDims = getPartCylinderDimensions(part);

    const proxySize = part.collisionConfig?.envelopeSize;
    const proxyCenter = part.collisionConfig?.envelopeCenter;

    // WheelModel places axle along local +X and radius in local Y-Z.
    const localHalfExtents: [number, number, number] =
      part.type === "Wheel"
        ? [cylinderDims.width / 2, cylinderDims.radius, cylinderDims.radius]
        : proxySize
          ? [proxySize[0] / 2, proxySize[1] / 2, proxySize[2] / 2]
          : [boxExtents[0] / 2, boxExtents[1] / 2, boxExtents[2] / 2];

    const [hx, , hz] = computeRotatedHalfExtents(
      localHalfExtents,
      part.rotation
    );

    let centerX = part.position[0];
    let centerZ = part.position[2];
    if (proxyCenter && (proxyCenter[0] !== 0 || proxyCenter[1] !== 0 || proxyCenter[2] !== 0)) {
      const cosY = Math.cos(-(part.rotation?.[1] ?? 0));
      const sinY = Math.sin(-(part.rotation?.[1] ?? 0));
      centerX += proxyCenter[0] * cosY - proxyCenter[2] * sinY;
      centerZ += proxyCenter[0] * sinY + proxyCenter[2] * cosY;
    }

    const partMaxX = Math.max(
      Math.abs(centerX - hx),
      Math.abs(centerX + hx)
    );
    const partMaxZ = Math.max(
      Math.abs(centerZ - hz),
      Math.abs(centerZ + hz)
    );

    if (partMaxX > maxAbsX) maxAbsX = partMaxX;
    if (partMaxZ > maxAbsZ) maxAbsZ = partMaxZ;
  }

  const lengthM =
    maxAbsX > 0 ? maxAbsX * 2 : (fallback?.lengthM ?? 0.5);
  const widthM =
    maxAbsZ > 0 ? maxAbsZ * 2 : (fallback?.widthM ?? 0.5);

  return { lengthM, widthM };
}

/**
 * Resolves full Workshop-to-Simulation visual specification for all installed parts,
 * including per-part geometry dimensions, grounding offset, drivetrain wheel mapping,
 * axle spin directions, and assembly-consistent X-Z footprint.
 */
export function resolveAssemblySimulationVisualSpec(params: {
  readonly parts: readonly RobotPart[];
  readonly connections?: readonly RobotConnection[];
  readonly drivetrain?: DrivetrainConfiguration | null;
  readonly hiddenPartIds?: ReadonlySet<string> | readonly string[];
}): ResolvedAssemblyVisualSpec {
  const hiddenSet =
    params.hiddenPartIds instanceof Set
      ? params.hiddenPartIds
      : new Set(params.hiddenPartIds ?? []);

  const visibleParts = params.parts.filter((part) => !hiddenSet.has(part.id));
  const hasProceduralMembers = visibleParts.some((part) =>
    Boolean(part.foundationMemberRole)
  );
  const wheelSideMap = resolveDrivetrainWheelSideMap(
    visibleParts,
    params.drivetrain,
    params.connections
  );

  let minBottomY = Number.POSITIVE_INFINITY;
  let motorCount = 0;
  let wheelCount = 0;
  let hasChassis = false;
  const leftWheelPartIds: string[] = [];
  const rightWheelPartIds: string[] = [];

  const resolvedParts: ResolvedAssemblyVisualPart[] = visibleParts.map((part) => {
    const kind = classifyAssemblyPartKind(part);
    const boxExtents = getPartBoxExtents(part);
    const cylinderDimensions = getPartCylinderDimensions(part);

    if (kind === "chassis") hasChassis = true;
    if (kind === "motor") motorCount += 1;
    if (kind === "wheel") wheelCount += 1;

    const drivetrainSide =
      kind === "wheel" ? (wheelSideMap.get(part.id) ?? null) : null;
    if (drivetrainSide === "left") leftWheelPartIds.push(part.id);
    if (drivetrainSide === "right") rightWheelPartIds.push(part.id);

    const localHalfExtents: [number, number, number] =
      kind === "wheel"
        ? [
            cylinderDimensions.width / 2,
            cylinderDimensions.radius,
            cylinderDimensions.radius,
          ]
        : [boxExtents[0] / 2, boxExtents[1] / 2, boxExtents[2] / 2];

    const [, rotatedHalfY] = computeRotatedHalfExtents(
      localHalfExtents,
      part.rotation
    );
    const bottomY = part.position[1] - rotatedHalfY;
    if (bottomY < minBottomY) {
      minBottomY = bottomY;
    }

    const axleSpinSign =
      kind === "wheel"
        ? computeWheelAxleSpinSign(part.rotation, drivetrainSide)
        : 1;

    return {
      partId: part.id,
      name: part.name,
      type: part.type,
      kind,
      position: [part.position[0], part.position[1], part.position[2]],
      rotation: [part.rotation[0], part.rotation[1], part.rotation[2]],
      color: part.color,
      boxExtents,
      cylinderDimensions,
      drivetrainSide,
      axleSpinSign,
      wheelCategory: kind === "wheel" ? resolveWheelCategory(part) : "Rubber",
      structuralVisualShape: part.structuralVisualShape,
      meshAssetId: part.meshAssetId,
      meshTransform: part.meshTransform,
      mountingPatterns: part.mountingPatterns,
      hideSolidChassisShell:
        kind === "chassis" && hasProceduralMembers && !part.meshAssetId,
      geometryShape: part.geometry?.shape,
      cylinderAxis:
        part.geometry?.shape === "cylinder" ? part.geometry.axis : undefined,
      batteryMeta:
        kind === "battery" ? resolveBatteryMetadata(part) : undefined,
      controllerMeta:
        kind === "controller" ? resolveControllerMetadata(part) : undefined,
    };
  });

  const rawOffsetY =
    resolvedParts.length > 0 && Number.isFinite(minBottomY) ? -minBottomY : 0;
  const verticalOffsetY = Object.is(rawOffsetY, -0) ? 0 : rawOffsetY;

  return {
    parts: resolvedParts,
    verticalOffsetY,
    footprint: computeAssemblyFootprintDimensions(visibleParts),
    leftWheelPartIds,
    rightWheelPartIds,
    motorCount,
    wheelCount,
    hasChassis,
  };
}

/**
 * Merges physics-derived wheel/chassis footprint with assembled chassis/part bounds so
 * the OBB collision envelope faithfully contains the assembled robot without shrinking
 * wheel extents.
 */
export function resolveCompiledRobotFootprint(
  robotConfig: SimulationRobotConfig,
  parts?: readonly RobotPart[],
  hiddenPartIds?: ReadonlySet<string> | readonly string[]
): AssemblyFootprintDimensions {
  const physicsFootprint = deriveRobotFootprintDimensions(robotConfig);
  if (!parts || parts.length === 0) {
    return physicsFootprint;
  }

  const hiddenSet =
    hiddenPartIds instanceof Set
      ? hiddenPartIds
      : new Set(hiddenPartIds ?? []);
  const visibleParts = parts.filter((part) => !hiddenSet.has(part.id));
  if (visibleParts.length === 0) {
    return physicsFootprint;
  }

  const assemblyFootprint = computeAssemblyFootprintDimensions(
    visibleParts,
    physicsFootprint
  );

  return {
    lengthM: Math.max(physicsFootprint.lengthM, assemblyFootprint.lengthM),
    widthM: Math.max(physicsFootprint.widthM, assemblyFootprint.widthM),
  };
}

function isSpawnPoseCollisionFree(
  pose: SimulationSpawnPose,
  footprint: AssemblyFootprintDimensions,
  arena: ArenaConfig,
  marginM = 0.05
): boolean {
  if (
    !Number.isFinite(pose.x) ||
    !Number.isFinite(pose.z) ||
    !Number.isFinite(pose.heading)
  ) {
    return false;
  }

  const envelope = createRobotCollisionEnvelope(
    {
      x: pose.x,
      z: pose.z,
      headingRadians: pose.heading,
    },
    {
      lengthM: footprint.lengthM + marginM * 2,
      widthM: footprint.widthM + marginM * 2,
    }
  );

  // Ensure every OBB corner remains strictly inside interior arena bounds
  const corners = [
    envelope.vertices.frontLeft,
    envelope.vertices.frontRight,
    envelope.vertices.rearLeft,
    envelope.vertices.rearRight,
  ];
  for (const corner of corners) {
    if (
      corner.x < arena.bounds.minX ||
      corner.x > arena.bounds.maxX ||
      corner.z < arena.bounds.minZ ||
      corner.z > arena.bounds.maxZ
    ) {
      return false;
    }
  }

  const query = detectArenaCollisions(envelope, arena);
  return !query.hasCollision;
}

/**
 * Resolves a deterministic, collision-free spawn pose within the arena interior.
 * Preserves the requested pose (or arena center if unspecified) whenever valid, and
 * falls back to searching the nearest collision-free grid candidate inside bounds.
 */
export function resolveSafeSimulationSpawnPose(
  arena: ArenaConfig,
  footprint: AssemblyFootprintDimensions,
  preferredPose?: Partial<SimulationSpawnPose>
): SimulationSpawnResolutionResult {
  const centerX = (arena.bounds.minX + arena.bounds.maxX) * 0.5;
  const centerZ = (arena.bounds.minZ + arena.bounds.maxZ) * 0.5;
  const heading =
    typeof preferredPose?.heading === "number" &&
    Number.isFinite(preferredPose.heading)
      ? preferredPose.heading
      : 0;

  const targetPose: SimulationSpawnPose = {
    x:
      typeof preferredPose?.x === "number" && Number.isFinite(preferredPose.x)
        ? preferredPose.x
        : Object.is(centerX, -0)
        ? 0
        : centerX,
    z:
      typeof preferredPose?.z === "number" && Number.isFinite(preferredPose.z)
        ? preferredPose.z
        : Object.is(centerZ, -0)
        ? 0
        : centerZ,
    heading: Object.is(heading, -0) ? 0 : heading,
  };

  if (isSpawnPoseCollisionFree(targetPose, footprint, arena)) {
    return {
      valid: true,
      pose: targetPose,
      adjustedFromPreferred: false,
    };
  }

  // Try explicit arena center if caller provided an off-center preferred pose that collided
  const anchors: SimulationSpawnPose[] = [targetPose];
  const cleanCenterX = Object.is(centerX, -0) ? 0 : centerX;
  const cleanCenterZ = Object.is(centerZ, -0) ? 0 : centerZ;
  if (
    Math.abs(targetPose.x - cleanCenterX) > 1e-6 ||
    Math.abs(targetPose.z - cleanCenterZ) > 1e-6
  ) {
    const centerPose: SimulationSpawnPose = {
      x: cleanCenterX,
      z: cleanCenterZ,
      heading: targetPose.heading,
    };
    if (isSpawnPoseCollisionFree(centerPose, footprint, arena)) {
      return {
        valid: true,
        pose: centerPose,
        adjustedFromPreferred: true,
      };
    }
    anchors.push(centerPose);
  }

  // Deterministic centered grid search inside interior arena bounds
  const arenaSpanX = arena.bounds.maxX - arena.bounds.minX;
  const arenaSpanZ = arena.bounds.maxZ - arena.bounds.minZ;
  const stepM = Math.max(0.2, Math.min(arenaSpanX, arenaSpanZ) / 24);
  const maxStepsX = Math.ceil(arenaSpanX / stepM);
  const maxStepsZ = Math.ceil(arenaSpanZ / stepM);

  const candidates: Array<{
    pose: SimulationSpawnPose;
    distSq: number;
  }> = [];

  for (let ix = -maxStepsX; ix <= maxStepsX; ix++) {
    const x = cleanCenterX + ix * stepM;
    if (x < arena.bounds.minX || x > arena.bounds.maxX) continue;
    for (let iz = -maxStepsZ; iz <= maxStepsZ; iz++) {
      const z = cleanCenterZ + iz * stepM;
      if (z < arena.bounds.minZ || z > arena.bounds.maxZ) continue;
      const cleanX = Math.abs(x) < 1e-9 ? 0 : Number(x.toFixed(6));
      const cleanZ = Math.abs(z) < 1e-9 ? 0 : Number(z.toFixed(6));
      const dx = cleanX - anchors[0].x;
      const dz = cleanZ - anchors[0].z;
      candidates.push({
        pose: { x: cleanX, z: cleanZ, heading: targetPose.heading },
        distSq: dx * dx + dz * dz,
      });
    }
  }

  // Deterministic distance + coordinate tie-break sort
  candidates.sort((a, b) => {
    const diff = a.distSq - b.distSq;
    if (Math.abs(diff) > 1e-9) return diff;
    if (Math.abs(a.pose.x - b.pose.x) > 1e-9) return a.pose.x - b.pose.x;
    return a.pose.z - b.pose.z;
  });

  const headingCandidates = [
    targetPose.heading,
    0,
    Math.PI / 2,
    -Math.PI / 2,
    Math.PI,
  ];

  for (const h of headingCandidates) {
    for (const candidate of candidates) {
      const testPose: SimulationSpawnPose = {
        x: candidate.pose.x,
        z: candidate.pose.z,
        heading: h,
      };
      if (isSpawnPoseCollisionFree(testPose, footprint, arena)) {
        return {
          valid: true,
          pose: testPose,
          adjustedFromPreferred: true,
        };
      }
    }
  }

  return {
    valid: false,
    error: `No valid collision-free spawn position exists in arena "${arena.name || arena.id}" for robot footprint (${footprint.lengthM.toFixed(2)}m x ${footprint.widthM.toFixed(2)}m).`,
  };
}

export interface SimulationCollisionVisualState {
  readonly showFootprintOutline: boolean;
  readonly footprintOutlineColor: string;
  readonly footprintOutlineOpacity: number;
  readonly showCollisionHighlight: boolean;
  readonly collisionHighlightColor: string;
  readonly inspectionHighlightColor: string;
}

/**
 * Strictly decouples permanent neutral robot footprint visualization from transient
 * active-collision alerts and read-only component inspection highlighting.
 */
export function resolveCollisionVisualState(
  hasCollision: boolean
): SimulationCollisionVisualState {
  return {
    showFootprintOutline: true,
    footprintOutlineColor: "#64748b",
    footprintOutlineOpacity: 0.48,
    showCollisionHighlight: Boolean(hasCollision),
    collisionHighlightColor: "#ef4444",
    inspectionHighlightColor: "#38bdf8",
  };
}

export interface AssemblyInspectionComponentItem {
  readonly partId: string;
  readonly name: string;
  readonly type: RobotPart["type"];
  readonly kind: AssemblyVisualPartKind;
  readonly categoryLabel: string;
  readonly dimensionsLabel: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly boxExtents: readonly [number, number, number];
  readonly drivetrainSide: DrivetrainSide | null;
  readonly detailTag: string | null;
}

export interface AssemblyInspectionSummary {
  readonly componentCount: number;
  readonly foundationLabel: string;
  readonly drivetrainType: string;
  readonly motorCount: number;
  readonly wheelCount: number;
  readonly batteryName: string | null;
  readonly controllerName: string | null;
  readonly footprint: AssemblyFootprintDimensions;
  readonly items: readonly AssemblyInspectionComponentItem[];
}

function formatCategoryLabel(kind: AssemblyVisualPartKind): string {
  switch (kind) {
    case "chassis":
      return "Foundation";
    case "top-plate":
      return "Armor Plate";
    case "bumper":
      return "Front Bumper";
    case "motor":
      return "Drive Motor";
    case "wheel":
      return "Wheel";
    case "battery":
      return "Battery";
    case "controller":
      return "Controller";
    case "structural":
      return "Structure";
  }
}

function formatDimensionsLabel(part: ResolvedAssemblyVisualPart): string {
  if (part.kind === "wheel") {
    return `Ø ${part.cylinderDimensions.diameter.toFixed(2)} × ${part.cylinderDimensions.width.toFixed(2)} m`;
  }
  return `${part.boxExtents[0].toFixed(2)} × ${part.boxExtents[1].toFixed(2)} × ${part.boxExtents[2].toFixed(2)} m`;
}

/**
 * Builds an inspection summary directly from the Workshop assembly parts,
 * foundation, drivetrain, and compiled simulation footprint without fabricating details.
 */
export function buildAssemblyInspectionSummary(params: {
  readonly parts: readonly RobotPart[];
  readonly connections?: readonly RobotConnection[];
  readonly drivetrain?: DrivetrainConfiguration | null;
  readonly foundation?: FoundationConfig | null;
  readonly robotConfig: SimulationRobotConfig;
  readonly footprint?: AssemblyFootprintDimensions;
}): AssemblyInspectionSummary {
  const visualSpec = resolveAssemblySimulationVisualSpec({
    parts: params.parts,
    connections: params.connections,
    drivetrain: params.drivetrain,
  });
  const partMap = new Map(params.parts.map((part) => [part.id, part]));

  const items: AssemblyInspectionComponentItem[] = visualSpec.parts.map(
    (resolved) => {
      const sourcePart = partMap.get(resolved.partId);
      let detailTag: string | null = null;

      if (resolved.kind === "motor") {
        detailTag = sourcePart?.mountingZoneId ?? null;
      } else if (resolved.kind === "wheel") {
        detailTag =
          resolved.drivetrainSide === "left"
            ? "Left Drive"
            : resolved.drivetrainSide === "right"
            ? "Right Drive"
            : resolved.wheelCategory;
      } else if (resolved.kind === "battery") {
        const voltage = resolved.batteryMeta?.voltage;
        detailTag = voltage !== undefined ? `${voltage.toFixed(1)} V` : null;
      } else if (resolved.kind === "controller") {
        detailTag = resolved.controllerMeta?.variant ?? null;
      }

      return {
        partId: resolved.partId,
        name: resolved.name,
        type: resolved.type,
        kind: resolved.kind,
        categoryLabel: formatCategoryLabel(resolved.kind),
        dimensionsLabel: formatDimensionsLabel(resolved),
        position: resolved.position,
        rotation: resolved.rotation,
        boxExtents: resolved.boxExtents,
        drivetrainSide: resolved.drivetrainSide,
        detailTag,
      };
    }
  );

  const batteryPart = visualSpec.parts.find((p) => p.kind === "battery");
  const controllerPart = visualSpec.parts.find((p) => p.kind === "controller");

  const foundationLabel = params.foundation
    ? `${params.foundation.modelId} (${params.foundation.length.toFixed(2)} × ${params.foundation.width.toFixed(2)} m)`
    : "Custom Chassis";

  return {
    componentCount: items.length,
    foundationLabel,
    drivetrainType:
      params.drivetrain?.type ?? params.robotConfig.drivetrain.type,
    motorCount: visualSpec.motorCount,
    wheelCount: visualSpec.wheelCount,
    batteryName: batteryPart?.name ?? null,
    controllerName: controllerPart?.name ?? null,
    footprint: params.footprint ?? visualSpec.footprint,
    items,
  };
}

