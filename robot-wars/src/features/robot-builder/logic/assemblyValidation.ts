import { getPartBoundingExtents, getPartCylinderDimensions } from "./geometryAdapters";
import {
  evaluateInterfaceCompatibility,
  hasAttachmentCycle,
  resolvePartMountingInterfaces,
} from "./mountingInterfaces";
import type {
  DrivetrainConfiguration,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";

export type AssemblyDiagnosticSeverity = "error" | "warning" | "info";

export type AssemblyDiagnosticCode =
  | "missing-foundation"
  | "foundation-unconfirmed"
  | "invalid-dimension"
  | "outside-foundation-bounds"
  | "below-ground"
  | "missing-parent"
  | "circular-attachment"
  | "incompatible-interface"
  | "unknown-compatibility"
  | "unattached-part"
  | "motor-missing-wheel"
  | "wheel-unattached"
  | "component-overlap";

export interface AssemblyDiagnostic {
  readonly id: string;
  readonly severity: AssemblyDiagnosticSeverity;
  readonly code: AssemblyDiagnosticCode;
  readonly message: string;
  readonly partId?: string;
  readonly relatedPartId?: string;
}

export interface AssemblyValidationReport {
  readonly isValid: boolean;
  readonly errors: readonly AssemblyDiagnostic[];
  readonly warnings: readonly AssemblyDiagnostic[];
  readonly infos: readonly AssemblyDiagnostic[];
  readonly diagnostics: readonly AssemblyDiagnostic[];
  readonly diagnosticsByPartId: Readonly<Record<string, readonly AssemblyDiagnostic[]>>;
  readonly assemblyBounds: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
}

interface WorldAabb {
  readonly partId: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function computeRotatedWorldAabb(part: RobotPart): WorldAabb {
  const extents = getPartBoundingExtents(part);
  const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
  const [hx, hy, hz] = [extents[0] * 0.5, extents[1] * 0.5, extents[2] * 0.5];

  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

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

  const worldHx = Math.abs(r00) * hx + Math.abs(r01) * hy + Math.abs(r02) * hz;
  const worldHy = Math.abs(r10) * hx + Math.abs(r11) * hy + Math.abs(r12) * hz;
  const worldHz = Math.abs(r20) * hx + Math.abs(r21) * hy + Math.abs(r22) * hz;

  return {
    partId: part.id,
    minX: part.position[0] - worldHx,
    maxX: part.position[0] + worldHx,
    minY: part.position[1] - worldHy,
    maxY: part.position[1] + worldHy,
    minZ: part.position[2] - worldHz,
    maxZ: part.position[2] + worldHz,
  };
}

function computeAabbOverlapDepth(a: WorldAabb, b: WorldAabb): number {
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return 0;
  return Math.min(overlapX, overlapY, overlapZ);
}

function isIntentionalContactPair(
  a: RobotPart,
  b: RobotPart,
  connections: readonly RobotConnection[]
): boolean {
  // Direct parent-child connection intentionally seats child onto parent face/shaft
  const isDirectParentChild = connections.some((c) => {
    const p = c.parentId ?? c.sourceId;
    const ch = c.childId ?? c.targetId;
    return (p === a.id && ch === b.id) || (p === b.id && ch === a.id);
  });
  if (isDirectParentChild) return true;

  // Built-in foundation subcomponents rest flush against chassis/top plate
  const isFoundationSubPart = (id: string) =>
    id === "foundation-chassis" ||
    id === "foundation-top-plate" ||
    id === "foundation-front-cover";
  if (isFoundationSubPart(a.id) && isFoundationSubPart(b.id)) return true;

  // Top plate sits between chassis and deck-mounted batteries/controllers/structural parts
  if (
    a.id === "foundation-top-plate" ||
    b.id === "foundation-top-plate"
  ) {
    const other = a.id === "foundation-top-plate" ? b : a;
    if (other.type === "Battery" || other.type === "Controller") return true;
  }

  return false;
}

/**
 * Performs comprehensive non-destructive placement, attachment, compatibility,
 * and simplified AABB overlap validation across the Workshop assembly.
 *
 * Limitations: Uses world-aligned bounding boxes (AABB) for pairwise interference checks;
 * thin hollow brackets or angled cutouts may report conservative envelope overlap.
 */
export function validateRobotAssembly(params: {
  readonly parts: readonly RobotPart[];
  readonly connections: readonly RobotConnection[];
  readonly foundation: FoundationConfig | null;
  readonly drivetrain?: DrivetrainConfiguration | null;
}): AssemblyValidationReport {
  const { parts, connections, foundation } = params;
  const diagnostics: AssemblyDiagnostic[] = [];
  const partMap = new Map(parts.map((part) => [part.id, part]));

  const pushDiagnostic = (diag: AssemblyDiagnostic) => {
    diagnostics.push(diag);
  };

  if (!foundation || !partMap.has("foundation-chassis")) {
    pushDiagnostic({
      id: "foundation-missing",
      severity: "error",
      code: "missing-foundation",
      message: "No robot foundation is active. Start a foundation build to anchor assembly components.",
    });
  } else if (!foundation.confirmed) {
    pushDiagnostic({
      id: "foundation-unconfirmed",
      severity: "info",
      code: "foundation-unconfirmed",
      partId: "foundation-chassis",
      message: "Foundation dimensions are not yet confirmed; component mounting is locked until confirmed.",
    });
  }

  // Map anchored tree back to foundation-chassis
  const parentOfChild = new Map<string, string>();
  for (const conn of connections) {
    const parentId = conn.parentId ?? conn.sourceId;
    const childId = conn.childId ?? conn.targetId;
    if (parentId && childId) {
      parentOfChild.set(childId, parentId);
    }
  }

  const isAnchoredToFoundation = (partId: string): boolean => {
    if (
      partId === "foundation-chassis" ||
      partId === "foundation-top-plate" ||
      partId === "foundation-front-cover"
    ) {
      return true;
    }
    let current = partId;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return false;
      visited.add(current);
      if (current === "foundation-chassis") return true;
      current = parentOfChild.get(current) ?? "";
    }
    return false;
  };

  // Validate per-part dimensions, ground clearance & boundary envelope
  const aabbs: WorldAabb[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const part of parts) {
    const extents = getPartBoundingExtents(part);
    const hasInvalidDim =
      extents.some((val) => !Number.isFinite(val) || val <= 0) ||
      !Number.isFinite(part.massKg ?? part.mass) ||
      (part.massKg ?? part.mass) <= 0;

    if (hasInvalidDim) {
      pushDiagnostic({
        id: `invalid-dim-${part.id}`,
        severity: "error",
        code: "invalid-dimension",
        partId: part.id,
        message: `${part.name} has non-positive or non-finite dimensions/mass.`,
      });
    }

    if (part.type === "Wheel") {
      const cyl = getPartCylinderDimensions(part);
      if (!Number.isFinite(cyl.diameter) || cyl.diameter <= 0 || cyl.width <= 0) {
        pushDiagnostic({
          id: `invalid-wheel-${part.id}`,
          severity: "error",
          code: "invalid-dimension",
          partId: part.id,
          message: `${part.name} has invalid cylindrical diameter or width.`,
        });
      }
    }

    const aabb = computeRotatedWorldAabb(part);
    aabbs.push(aabb);
    minX = Math.min(minX, aabb.minX);
    maxX = Math.max(maxX, aabb.maxX);
    minY = Math.min(minY, aabb.minY);
    maxY = Math.max(maxY, aabb.maxY);
    minZ = Math.min(minZ, aabb.minZ);
    maxZ = Math.max(maxZ, aabb.maxZ);

    if (aabb.minY < -0.25) {
      pushDiagnostic({
        id: `below-ground-${part.id}`,
        severity: "warning",
        code: "below-ground",
        partId: part.id,
        message: `${part.name} extends ${(Math.abs(aabb.minY) * 100).toFixed(1)} cm below ground plane (Y < 0).`,
      });
    }

    if (foundation && part.id !== "foundation-chassis") {
      const allowedOverhangX =
        part.type === "Front Bumper" || part.type === "Wheel" ? 0.65 : 0.45;
      const allowedOverhangZ =
        part.type === "Wheel" || part.type === "Motor" ? 0.85 : 0.45;
      if (
        Math.abs(part.position[0]) > foundation.length * 0.5 + allowedOverhangX ||
        Math.abs(part.position[2]) > foundation.width * 0.5 + allowedOverhangZ
      ) {
        pushDiagnostic({
          id: `bounds-${part.id}`,
          severity: "warning",
          code: "outside-foundation-bounds",
          partId: part.id,
          message: `${part.name} is positioned noticeably outside the foundation envelope.`,
        });
      }

      if (!isAnchoredToFoundation(part.id)) {
        pushDiagnostic({
          id: `unattached-${part.id}`,
          severity: "warning",
          code: "unattached-part",
          partId: part.id,
          message: `${part.name} is not mechanically attached to the foundation assembly.`,
        });
      }
    }

    if (part.parentAttachmentId) {
      const conn = connections.find((c) => c.id === part.parentAttachmentId);
      if (!conn || !partMap.has(conn.parentId ?? conn.sourceId)) {
        pushDiagnostic({
          id: `missing-parent-${part.id}`,
          severity: "error",
          code: "missing-parent",
          partId: part.id,
          message: `${part.name} references a missing parent attachment.`,
        });
      }
    }

    if (part.type === "Motor") {
      const hasWheel = connections.some(
        (c) =>
          c.type === "Motor-Wheel" &&
          (c.parentId ?? c.sourceId) === part.id &&
          partMap.has(c.childId ?? c.targetId)
      );
      if (!hasWheel) {
        pushDiagnostic({
          id: `motor-wheel-${part.id}`,
          severity: "info",
          code: "motor-missing-wheel",
          partId: part.id,
          message: `${part.name} does not yet have a wheel mounted on its output shaft.`,
        });
      }
    }

    if (part.type === "Wheel") {
      const hasMotor = connections.some(
        (c) =>
          c.type === "Motor-Wheel" &&
          (c.childId ?? c.targetId) === part.id &&
          partMap.has(c.parentId ?? c.sourceId)
      );
      if (!hasMotor) {
        pushDiagnostic({
          id: `wheel-unattached-${part.id}`,
          severity: "warning",
          code: "wheel-unattached",
          partId: part.id,
          message: `${part.name} is not connected to a drive motor shaft.`,
        });
      }
    }
  }

  // Validate connections (cycles + mounting interface compatibility)
  for (const conn of connections) {
    const parentId = conn.parentId ?? conn.sourceId;
    const childId = conn.childId ?? conn.targetId;
    const parentPart = partMap.get(parentId);
    const childPart = partMap.get(childId);

    if (!parentPart || !childPart) {
      pushDiagnostic({
        id: `dangling-conn-${conn.id}`,
        severity: "error",
        code: "missing-parent",
        partId: childId,
        relatedPartId: parentId,
        message: `Connection "${conn.id}" references a missing component.`,
      });
      continue;
    }

    if (hasAttachmentCycle(connections, parentId, childId) && parentId === childId) {
      pushDiagnostic({
        id: `cycle-${conn.id}`,
        severity: "error",
        code: "circular-attachment",
        partId: childId,
        relatedPartId: parentId,
        message: `Circular attachment detected involving ${childPart.name}.`,
      });
    }

    if (conn.type === "Mechanical") {
      const parentInterfaces = resolvePartMountingInterfaces(parentPart, foundation);
      const childInterfaces = resolvePartMountingInterfaces(childPart, foundation);
      const pIface = parentInterfaces.find((i) => i.id === conn.parentMountPointId);
      const cIface = childInterfaces.find((i) => i.id === conn.childMountPointId);

      // Legacy motor/battery/controller zone mount IDs without interface records are valid
      const isLegacyBuiltInMount =
        conn.parentMountPointId === "foundation-zone" ||
        conn.parentMountPointId === "foundation-chassis";

      if (!isLegacyBuiltInMount && pIface && cIface) {
        const compat = evaluateInterfaceCompatibility(pIface, cIface);
        if (compat.status === "incompatible") {
          pushDiagnostic({
            id: `compat-${conn.id}`,
            severity: "warning",
            code: "incompatible-interface",
            partId: childPart.id,
            relatedPartId: parentPart.id,
            message: `${childPart.name} → ${parentPart.name}: ${compat.reason}`,
          });
        } else if (compat.status === "unknown") {
          pushDiagnostic({
            id: `compat-unk-${conn.id}`,
            severity: "info",
            code: "unknown-compatibility",
            partId: childPart.id,
            relatedPartId: parentPart.id,
            message: `${childPart.name} → ${parentPart.name}: ${compat.reason}`,
          });
        }
      } else if (!isLegacyBuiltInMount && (!pIface || !cIface)) {
        pushDiagnostic({
          id: `compat-unverified-${conn.id}`,
          severity: "info",
          code: "unknown-compatibility",
          partId: childPart.id,
          relatedPartId: parentPart.id,
          message: `${childPart.name} attachment uses unverified interface metadata.`,
        });
      }
    }
  }

  // Simplified pairwise AABB interference detection (ignoring intentional attachments)
  const overlapThresholdM = 0.025;
  for (let i = 0; i < aabbs.length; i++) {
    const a = parts[i];
    const boxA = aabbs[i];
    for (let j = i + 1; j < aabbs.length; j++) {
      const b = parts[j];
      const boxB = aabbs[j];
      if (isIntentionalContactPair(a, b, connections)) continue;

      const depth = computeAabbOverlapDepth(boxA, boxB);
      if (depth > overlapThresholdM) {
        pushDiagnostic({
          id: `overlap-${a.id}-${b.id}`,
          severity: "warning",
          code: "component-overlap",
          partId: a.id,
          relatedPartId: b.id,
          message: `${a.name} overlaps ${b.name} by ~${(depth * 100).toFixed(1)} cm.`,
        });
      }
    }
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info");

  const byPart: Record<string, AssemblyDiagnostic[]> = {};
  for (const diag of diagnostics) {
    if (diag.partId) {
      (byPart[diag.partId] ??= []).push(diag);
    }
    if (diag.relatedPartId && diag.relatedPartId !== diag.partId) {
      (byPart[diag.relatedPartId] ??= []).push(diag);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    infos,
    diagnostics,
    diagnosticsByPartId: byPart,
    assemblyBounds: parts.length
      ? { minX, maxX, minY, maxY, minZ, maxZ }
      : { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
  };
}
