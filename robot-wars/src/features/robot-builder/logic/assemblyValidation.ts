import { Euler, Vector3 } from "three";
import { resolveMotorMechanicalSupport, validateDrivetrain } from "./drivetrain";
import { getPartBoundingExtents, getPartCylinderDimensions } from "./geometryAdapters";
import { getMeshAssetRecord } from "./meshAssetRegistry";
import {
  evaluateComponentAttachmentCompatibility,
  evaluateMotorMountCompatibility,
  evaluateMotorWheelCompatibility,
} from "./mechanicalCompatibility";
import {
  resolvePartMountingInterfaces,
} from "./mountingInterfaces";
import { generateMountingPatternPoints } from "./mountingPatterns";
import { validateProceduralFoundationConfig } from "./proceduralFoundation";
import type {
  ElectricalConnection,
  ElectricalValidationReport,
} from "../../electrical/types/electrical.types";
import { validateElectricalAssembly } from "../../electrical/logic/electricalValidation";
import type {
  DrivetrainConfiguration,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";

export type AssemblyDiagnosticSeverity = "error" | "warning" | "info";

export type AssemblySubsystemKey =
  | "foundation"
  | "structural"
  | "motors"
  | "wheelsAndDrivetrain"
  | "compatibility";

export type SubsystemHealthStatus = "healthy" | "warning" | "error" | "unknown";

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
  | "motor-mount-issue"
  | "wheel-unattached"
  | "tight-clearance"
  | "drivetrain-invalid"
  | "component-overlap"
  | "procedural-foundation-invalid"
  | "mounting-pattern-invalid"
  | "imported-mesh-invalid"
  | "imported-mesh-open"
  | "unit-ambiguity"
  | "unknown-engineering-property"
  | "missing-collision-proxy";

export interface AssemblyDiagnostic {
  readonly id: string;
  readonly severity: AssemblyDiagnosticSeverity;
  readonly code: AssemblyDiagnosticCode;
  readonly message: string;
  readonly partId?: string;
  readonly relatedPartId?: string;
  readonly affectedPartIds?: readonly string[];
  readonly title?: string;
  readonly reason?: string;
  readonly conditionEvaluated?: string;
  readonly correctiveAction?: string;
  readonly subsystem?: AssemblySubsystemKey;
  readonly isUnknownAssumption?: boolean;
  readonly provenanceMethod?: string;
}

export interface SubsystemHealthSummary {
  readonly key: AssemblySubsystemKey;
  readonly label: string;
  readonly status: SubsystemHealthStatus;
  readonly summary: string;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly unknownCount: number;
}

export interface AssemblyValidationReport {
  readonly isValid: boolean;
  readonly healthStatus: SubsystemHealthStatus;
  readonly errors: readonly AssemblyDiagnostic[];
  readonly warnings: readonly AssemblyDiagnostic[];
  readonly infos: readonly AssemblyDiagnostic[];
  readonly diagnostics: readonly AssemblyDiagnostic[];
  readonly diagnosticsByPartId: Readonly<Record<string, readonly AssemblyDiagnostic[]>>;
  readonly subsystems: readonly SubsystemHealthSummary[];
  readonly electricalReport?: ElectricalValidationReport;
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

interface OrientedBox3D {
  readonly center: Vector3;
  readonly axes: readonly [Vector3, Vector3, Vector3];
  readonly halfExtents: readonly [number, number, number];
}

function buildOrientedBox3D(part: RobotPart): OrientedBox3D {
  const extents = getPartBoundingExtents(part);
  const euler = new Euler(...(part.rotation ?? [0, 0, 0]), "XYZ");
  const axisX = new Vector3(1, 0, 0).applyEuler(euler).normalize();
  const axisY = new Vector3(0, 1, 0).applyEuler(euler).normalize();
  const axisZ = new Vector3(0, 0, 1).applyEuler(euler).normalize();

  return {
    center: new Vector3(...part.position),
    axes: [axisX, axisY, axisZ],
    halfExtents: [extents[0] * 0.5, extents[1] * 0.5, extents[2] * 0.5],
  };
}

function projectBoxRadius(box: OrientedBox3D, axis: Vector3): number {
  return (
    box.halfExtents[0] * Math.abs(box.axes[0].dot(axis)) +
    box.halfExtents[1] * Math.abs(box.axes[1].dot(axis)) +
    box.halfExtents[2] * Math.abs(box.axes[2].dot(axis))
  );
}

/**
 * Exact 15-axis 3D Oriented Bounding Box (OBB) Separating Axis Theorem (SAT) overlap test.
 * Returns 0 when boxes are separated in 3D space (eliminating false positives on rotated beams),
 * or minimum penetration depth in meters when OBB volumes genuinely intersect.
 */
export function computeObbOverlapDepth3D(
  partA: RobotPart,
  partB: RobotPart
): number {
  const obbA = buildOrientedBox3D(partA);
  const obbB = buildOrientedBox3D(partB);
  const delta = new Vector3().subVectors(obbB.center, obbA.center);

  const testAxes: Vector3[] = [
    ...obbA.axes,
    ...obbB.axes,
  ];

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const cross = new Vector3().crossVectors(obbA.axes[i], obbB.axes[j]);
      const lenSq = cross.lengthSq();
      if (lenSq > 1e-8) {
        testAxes.push(cross.divideScalar(Math.sqrt(lenSq)));
      }
    }
  }

  let minPenetration = Number.POSITIVE_INFINITY;
  for (const axis of testAxes) {
    const dist = Math.abs(delta.dot(axis));
    const rA = projectBoxRadius(obbA, axis);
    const rB = projectBoxRadius(obbB, axis);
    const penetration = rA + rB - dist;
    if (penetration <= 0) {
      return 0;
    }
    if (penetration < minPenetration) {
      minPenetration = penetration;
    }
  }

  return Number.isFinite(minPenetration) ? minPenetration : 0;
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

function isIntentionalContactPair(
  a: RobotPart,
  b: RobotPart,
  connections: readonly RobotConnection[]
): boolean {
  const isDirectParentChild = connections.some((c) => {
    const p = c.parentId ?? c.sourceId;
    const ch = c.childId ?? c.targetId;
    return (p === a.id && ch === b.id) || (p === b.id && ch === a.id);
  });
  if (isDirectParentChild) return true;

  const isFoundationSubPart = (id: string) =>
    id === "foundation-chassis" ||
    id === "foundation-top-plate" ||
    id === "foundation-front-cover" ||
    id.startsWith("foundation-member-");
  if (isFoundationSubPart(a.id) && isFoundationSubPart(b.id)) return true;

  if (
    a.id === "foundation-top-plate" ||
    b.id === "foundation-top-plate" ||
    a.id === "foundation-member-base-plate" ||
    b.id === "foundation-member-base-plate"
  ) {
    const other =
      a.id === "foundation-top-plate" || a.id === "foundation-member-base-plate"
        ? b
        : a;
    if (other.type === "Battery" || other.type === "Controller") return true;
  }

  return false;
}

function summarizeSubsystem(
  key: AssemblySubsystemKey,
  label: string,
  diags: readonly AssemblyDiagnostic[],
  emptyHealthySummary: string
): SubsystemHealthSummary {
  const relevant = diags.filter((d) => d.subsystem === key);
  const errorCount = relevant.filter((d) => d.severity === "error").length;
  const warningCount = relevant.filter((d) => d.severity === "warning").length;
  const unknownCount = relevant.filter((d) => d.isUnknownAssumption).length;

  let status: SubsystemHealthStatus = "healthy";
  if (errorCount > 0) status = "error";
  else if (warningCount > 0) status = "warning";
  else if (unknownCount > 0) status = "unknown";

  const summary =
    relevant[0]?.title ??
    relevant[0]?.message ??
    emptyHealthySummary;

  return {
    key,
    label,
    status,
    summary,
    errorCount,
    warningCount,
    unknownCount,
  };
}

/**
 * Performs comprehensive placement, 3D OBB SAT interference, motor/wheel coupling,
 * attachment compatibility, provenance honesty, and subsystem health validation.
 */
export function validateRobotAssembly(params: {
  readonly parts: readonly RobotPart[];
  readonly connections: readonly RobotConnection[];
  readonly foundation: FoundationConfig | null;
  readonly drivetrain?: DrivetrainConfiguration | null;
  readonly electricalConnections?: readonly ElectricalConnection[];
}): AssemblyValidationReport {
  const {
    parts,
    connections,
    foundation,
    drivetrain,
    electricalConnections = [],
  } = params;
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
      subsystem: "foundation",
      title: "Foundation missing",
      message: "No robot foundation is active. Start a foundation build to anchor assembly components.",
      reason: "A primary foundation chassis is required as the mechanical root of the assembly.",
      conditionEvaluated: "Checked presence of foundation config and foundation-chassis root.",
      correctiveAction: "Start or select a foundation model in Step 1 (Foundation).",
    });
  } else if (!foundation.confirmed) {
    pushDiagnostic({
      id: "foundation-unconfirmed",
      severity: "info",
      code: "foundation-unconfirmed",
      partId: "foundation-chassis",
      subsystem: "foundation",
      title: "Foundation unconfirmed",
      message: "Foundation dimensions are not yet confirmed; component mounting is locked until confirmed.",
      reason: "Foundation geometry must be confirmed before attaching dependent subsystems.",
      conditionEvaluated: "Evaluated foundation.confirmed boolean flag.",
      correctiveAction: "Confirm foundation dimensions in Step 1 (Foundation).",
    });
  }

  if (foundation?.mode === "procedural" && foundation.procedural) {
    const procVal = validateProceduralFoundationConfig(foundation.procedural);
    procVal.errors.forEach((msg, idx) => {
      pushDiagnostic({
        id: `proc-err-${idx}`,
        severity: "error",
        code: "procedural-foundation-invalid",
        partId: "foundation-chassis",
        subsystem: "foundation",
        title: "Invalid procedural foundation configuration",
        message: msg,
        reason: msg,
        conditionEvaluated: "Validated procedural foundation architecture dimensions and structural continuity.",
        correctiveAction: "Adjust foundation length, width, rail dimensions, or flange settings.",
      });
    });
    procVal.warnings.forEach((msg, idx) => {
      pushDiagnostic({
        id: `proc-warn-${idx}`,
        severity: "warning",
        code: "procedural-foundation-invalid",
        partId: "foundation-chassis",
        subsystem: "foundation",
        title: "Procedural frame advisory",
        message: msg,
        reason: msg,
        conditionEvaluated: "Evaluated structural bracing and flange configuration.",
        correctiveAction: "Enable opposing rails, crossmembers, or tray flanges where needed.",
      });
    });
  }

  if (foundation && partMap.has("foundation-chassis")) {
    const hasTopPlate = partMap.has("foundation-top-plate");
    const hasFrontCover = partMap.has("foundation-front-cover");
    if (foundation.includeTopPlate !== hasTopPlate) {
      pushDiagnostic({
        id: "foundation-top-plate-flag-mismatch",
        severity: "error",
        code: "missing-foundation",
        partId: hasTopPlate ? "foundation-top-plate" : "foundation-chassis",
        relatedPartId: "foundation-chassis",
        subsystem: "foundation",
        title: "Foundation top-plate state mismatch",
        message: foundation.includeTopPlate
          ? "Foundation expects a top plate, but foundation-top-plate is missing."
          : "foundation-top-plate exists while foundation.includeTopPlate is disabled.",
        reason: "Foundation configuration flags must stay synchronized with foundation child parts.",
        conditionEvaluated: "Compared foundation.includeTopPlate with presence of foundation-top-plate.",
        correctiveAction: "Rebuild or toggle foundation top-plate option to resynchronize foundation parts.",
      });
    }
    if (foundation.includeFrontCover !== hasFrontCover) {
      pushDiagnostic({
        id: "foundation-front-cover-flag-mismatch",
        severity: "error",
        code: "missing-foundation",
        partId: hasFrontCover ? "foundation-front-cover" : "foundation-chassis",
        relatedPartId: "foundation-chassis",
        subsystem: "foundation",
        title: "Foundation front-cover state mismatch",
        message: foundation.includeFrontCover
          ? "Foundation expects a front cover, but foundation-front-cover is missing."
          : "foundation-front-cover exists while foundation.includeFrontCover is disabled.",
        reason: "Foundation configuration flags must stay synchronized with foundation child parts.",
        conditionEvaluated: "Compared foundation.includeFrontCover with presence of foundation-front-cover.",
        correctiveAction: "Rebuild or toggle foundation front-cover option to resynchronize foundation parts.",
      });
    }
  }

  const parentOfChild = new Map<string, string>();
  const connectionByChildId = new Map<string, RobotConnection>();
  const incomingByChild = new Map<string, RobotConnection[]>();
  const outgoingByParent = new Map<string, string[]>();
  const connectionById = new Map<string, RobotConnection>();

  for (const conn of connections) {
    connectionById.set(conn.id, conn);
    const parentId = conn.parentId ?? conn.sourceId;
    const childId = conn.childId ?? conn.targetId;
    if (!parentId || !childId) continue;

    if (partMap.has(parentId) && partMap.has(childId)) {
      const incoming = incomingByChild.get(childId) ?? [];
      incoming.push(conn);
      incomingByChild.set(childId, incoming);

      const outgoing = outgoingByParent.get(parentId) ?? [];
      outgoing.push(childId);
      outgoingByParent.set(parentId, outgoing);
    }

    if (parentId !== childId && !connectionByChildId.has(childId)) {
      parentOfChild.set(childId, parentId);
      connectionByChildId.set(childId, conn);
    }
  }

  const isAnchoredToFoundation = (partId: string): boolean => {
    if (partId === "foundation-chassis") {
      return partMap.has("foundation-chassis");
    }
    if (partId === "foundation-top-plate") {
      return Boolean(foundation?.includeTopPlate) && partMap.has("foundation-chassis");
    }
    if (partId === "foundation-front-cover") {
      return Boolean(foundation?.includeFrontCover) && partMap.has("foundation-chassis");
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

  const aabbs: WorldAabb[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const part of parts) {
    const extents = getPartBoundingExtents(part);
    const hasUnknownMass = part.importedEngineering?.massMode === "unknown";
    const hasInvalidExtents = extents.some((val) => !Number.isFinite(val) || val <= 0);
    const hasInvalidMass =
      !hasUnknownMass &&
      (!Number.isFinite(part.massKg ?? part.mass) || (part.massKg ?? part.mass) <= 0);

    if (hasInvalidExtents || hasInvalidMass) {
      pushDiagnostic({
        id: `invalid-dim-${part.id}`,
        severity: "error",
        code: "invalid-dimension",
        partId: part.id,
        subsystem: part.id.startsWith("foundation-") ? "foundation" : "structural",
        title: "Invalid physical dimensions or mass",
        message: `${part.name} has non-positive or non-finite dimensions/mass.`,
        reason: "All physical parts require finite positive dimensions (m) and mass (kg).",
        conditionEvaluated: "Verified finite positive extents and massKg.",
        correctiveAction: "Reset part dimensions/scale or specify valid positive mass.",
      });
    }

    // Mounting pattern checks
    for (const pattern of part.mountingPatterns ?? []) {
      const patternEval = generateMountingPatternPoints(pattern);
      for (const err of patternEval.errors) {
        pushDiagnostic({
          id: `pattern-err-${part.id}-${pattern.id}`,
          severity: "error",
          code: "mounting-pattern-invalid",
          partId: part.id,
          subsystem: "foundation",
          title: "Invalid mounting grid pattern",
          message: err,
          reason: err,
          conditionEvaluated: "Validated mounting pattern spacing and boundary extents.",
          correctiveAction: "Use positive spacing pitch and bounds for mounting pattern.",
        });
      }
      for (const warn of patternEval.warnings) {
        pushDiagnostic({
          id: `pattern-warn-${part.id}-${pattern.id}`,
          severity: "info",
          code: "mounting-pattern-invalid",
          partId: part.id,
          subsystem: "foundation",
          title: "Mounting pattern notice",
          message: warn,
          reason: warn,
          conditionEvaluated: "Evaluated pattern bounds fit and viewport preview sampling.",
          correctiveAction: "Adjust pattern spacing or bounds if tighter alignment is needed.",
        });
      }
    }

    // Imported STL asset inspection, unit ambiguity, engineering properties & collision proxy checks
    if (part.meshAssetId) {
      const asset = getMeshAssetRecord(part.meshAssetId);
      if (!asset || !asset.inspection.isValidGeometry) {
        pushDiagnostic({
          id: `stl-invalid-${part.id}`,
          severity: "error",
          code: "imported-mesh-invalid",
          partId: part.id,
          subsystem: part.id === "foundation-chassis" ? "foundation" : "structural",
          title: "Imported STL mesh unavailable or invalid",
          message: `${part.name} references missing or degenerate STL geometry.`,
          reason:
            asset?.inspection.errors.join(" ") ??
            "Session mesh asset buffer is not loaded or failed STL validation.",
          conditionEvaluated: "Checked in-memory meshAssetRegistry record and vertex validity.",
          correctiveAction: "Re-import a valid binary or ASCII STL file.",
        });
      } else if (!asset.inspection.isClosedManifold) {
        pushDiagnostic({
          id: `stl-open-${part.id}`,
          severity: "warning",
          code: "imported-mesh-open",
          partId: part.id,
          subsystem: part.id === "foundation-chassis" ? "foundation" : "structural",
          title: "Imported mesh open / non-manifold",
          message: `${part.name} mesh has ${asset.inspection.openEdgeCount} open edge(s) and ${asset.inspection.nonManifoldEdgeCount} non-manifold edge(s).`,
          reason: "Non-watertight meshes prevent reliable volume-based density mass calculation.",
          conditionEvaluated: "Checked half-edge sharing topology across all STL triangles.",
          correctiveAction: "Verify STL export solidity in CAD or enter mass manually.",
        });
      }

      if (part.meshTransform && !part.meshTransform.unitConfirmed) {
        pushDiagnostic({
          id: `stl-unit-${part.id}`,
          severity: "warning",
          code: "unit-ambiguity",
          partId: part.id,
          subsystem: "compatibility",
          title: "Unconfirmed STL import units",
          message: `${part.name} units (${part.meshTransform.unit}) have not been explicitly confirmed.`,
          reason: "STL files do not reliably embed physical unit metadata.",
          conditionEvaluated: "Checked ImportedMeshTransform.unitConfirmed.",
          correctiveAction: "Verify calculated SI dimensions and confirm import unit (mm/cm/m/in).",
        });
      }

      if (part.importedEngineering) {
        if (part.importedEngineering.massMode === "unknown" || !part.importedEngineering.massKg) {
          pushDiagnostic({
            id: `stl-unk-mass-${part.id}`,
            severity: "warning",
            code: "unknown-engineering-property",
            partId: part.id,
            subsystem: "compatibility",
            title: "Unknown mass on imported mesh",
            message: `${part.name} mass is marked unknown.`,
            reason: "Simulation inertia and weight require defined or density-estimated mass.",
            conditionEvaluated: "Checked importedEngineering.massMode and massKg.",
            correctiveAction: "Enter measured mass or choose closed-mesh density estimation.",
            isUnknownAssumption: true,
            provenanceMethod: "unknown",
          });
        }
        if (part.importedEngineering.materialId === "unknown") {
          pushDiagnostic({
            id: `stl-unk-mat-${part.id}`,
            severity: "info",
            code: "unknown-engineering-property",
            partId: part.id,
            subsystem: "compatibility",
            title: "Unknown material on imported mesh",
            message: `${part.name} material specification is marked unknown.`,
            reason: "No material preset or density assumption assigned.",
            conditionEvaluated: "Checked importedEngineering.materialId.",
            correctiveAction: "Select an engineering material preset or specify mass directly.",
            isUnknownAssumption: true,
            provenanceMethod: "unknown",
          });
        }
      }

      if (!part.collisionConfig || part.collisionConfig.boxes.length === 0) {
        pushDiagnostic({
          id: `stl-no-col-${part.id}`,
          severity: "warning",
          code: "missing-collision-proxy",
          partId: part.id,
          subsystem: "compatibility",
          title: "Missing collision representation",
          message: `${part.name} lacks a simplified collision proxy configuration.`,
          reason: "Simulation requires simplified bounding boxes or convex proxy instead of raw triangle mesh collision.",
          conditionEvaluated: "Checked part.collisionConfig boxes array.",
          correctiveAction: "Generate a Bounding Box or Multi-Box collision proxy in Inspector.",
        });
      }
    }

    if (part.type === "Wheel") {
      const cyl = getPartCylinderDimensions(part);
      if (!Number.isFinite(cyl.diameter) || cyl.diameter <= 0 || cyl.width <= 0) {
        pushDiagnostic({
          id: `invalid-wheel-${part.id}`,
          severity: "error",
          code: "invalid-dimension",
          partId: part.id,
          subsystem: "wheelsAndDrivetrain",
          title: "Invalid wheel geometry",
          message: `${part.name} has invalid cylindrical diameter or width.`,
          reason: "Simulation requires finite positive wheel diameter and axial tread width.",
          conditionEvaluated: "Checked cylinder diameter > 0 and axial width > 0.",
          correctiveAction: "Adjust wheel diameter and width in Step 6 (Wheels).",
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
        subsystem: "structural",
        title: "Below ground clearance",
        message: `${part.name} extends ${(Math.abs(aabb.minY) * 100).toFixed(1)} cm below ground plane (Y < 0).`,
        reason: "Part bounding box extends well below the floor reference plane.",
        conditionEvaluated: "Rotated world AABB minY < -0.25 m.",
        correctiveAction: "Raise part Y coordinate or adjust mount height in Inspector.",
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
          subsystem:
            part.type === "Wheel"
              ? "wheelsAndDrivetrain"
              : part.type === "Motor"
                ? "motors"
                : "structural",
          title: "Outside foundation envelope",
          message: `${part.name} is positioned noticeably outside the foundation envelope.`,
          reason: "Component overhang exceeds conservative stability envelope margin around chassis.",
          conditionEvaluated: "Checked |X| and |Z| against foundation half-extents + overhang allowance.",
          correctiveAction: "Move component closer to foundation or extend chassis dimensions.",
        });
      }

      if (!isAnchoredToFoundation(part.id) && part.type !== "Motor") {
        pushDiagnostic({
          id: `unattached-${part.id}`,
          severity: "warning",
          code: "unattached-part",
          partId: part.id,
          subsystem: part.type === "Wheel" ? "wheelsAndDrivetrain" : "structural",
          title: "Unattached component",
          message: `${part.name} is not mechanically attached to the foundation assembly.`,
          reason: "Component has no continuous Mechanical attachment path back to foundation-chassis.",
          conditionEvaluated: "Traversed parent-child attachment graph to foundation-chassis.",
          correctiveAction: "Select the component and attach it to a parent mounting point in Inspector.",
        });
      }
    }

    const validIncoming = incomingByChild.get(part.id) ?? [];
    if (part.id === "foundation-chassis") {
      if (part.parentAttachmentId || validIncoming.length > 0) {
        pushDiagnostic({
          id: "root-foundation-parented",
          severity: "error",
          code: "missing-parent",
          partId: part.id,
          relatedPartId:
            validIncoming[0]?.parentId ?? validIncoming[0]?.sourceId,
          subsystem: "foundation",
          title: "Foundation root cannot have a parent",
          message: `${part.name} is the root foundation chassis and cannot attach below another part.`,
          reason: "Foundation root must remain an unparented assembly anchor.",
          conditionEvaluated: "Verified foundation-chassis has no parentAttachmentId or incoming parent connections.",
          correctiveAction: "Remove parent attachment links targeting foundation-chassis.",
        });
      }
    } else {
      if (validIncoming.length > 1) {
        const parentNames = validIncoming
          .map((c) => {
            const pId = c.parentId ?? c.sourceId;
            return partMap.get(pId)?.name ?? pId;
          })
          .join(", ");
        pushDiagnostic({
          id: `duplicate-parent-${part.id}`,
          severity: "error",
          code: "missing-parent",
          partId: part.id,
          relatedPartId:
            validIncoming[1]?.parentId ?? validIncoming[1]?.sourceId,
          affectedPartIds: [
            part.id,
            ...validIncoming.map((c) => c.parentId ?? c.sourceId),
          ],
          subsystem: "compatibility",
          title: "Multiple parent attachments",
          message: `${part.name} has ${validIncoming.length} parent connections (${parentNames}); each child component may have at most one parent.`,
          reason: "Tree attachment hierarchy requires a unique parent per child part.",
          conditionEvaluated: "Checked incoming mechanical/motor-wheel edge count <= 1.",
          correctiveAction: "Detach extra parent connection so only one parent owns this component.",
        });
      }

      let emittedMissingParent = false;
      if (part.parentAttachmentId) {
        const conn = connectionById.get(part.parentAttachmentId);
        const connParentId = conn ? (conn.parentId ?? conn.sourceId) : "";
        const connChildId = conn ? (conn.childId ?? conn.targetId) : "";
        if (!conn || !partMap.has(connParentId) || connChildId !== part.id) {
          emittedMissingParent = true;
          pushDiagnostic({
            id: `missing-parent-${part.id}`,
            severity: "error",
            code: "missing-parent",
            partId: part.id,
            subsystem: "compatibility",
            title: "Missing parent attachment",
            message: `${part.name} references a missing or mismatched parent attachment.`,
            reason:
              "Child part holds a parentAttachmentId whose connection is missing, targets a different part, or lacks a valid parent.",
            conditionEvaluated:
              "Verified part.parentAttachmentId resolves to existing connection targeting this part and valid parent.",
            correctiveAction: "Detach and re-attach component in Part Inspector.",
          });
        }
      }

      const primaryIncoming = validIncoming.find(
        (c) => (c.parentId ?? c.sourceId) !== part.id
      );
      if (
        !emittedMissingParent &&
        primaryIncoming &&
        part.parentAttachmentId !== primaryIncoming.id
      ) {
        pushDiagnostic({
          id: `missing-parent-sync-${part.id}`,
          severity: "error",
          code: "missing-parent",
          partId: part.id,
          relatedPartId: primaryIncoming.parentId ?? primaryIncoming.sourceId,
          subsystem: "compatibility",
          title: "Out-of-sync parent attachment ID",
          message: `${part.name} has an incoming attachment "${primaryIncoming.id}" not recorded on part.parentAttachmentId.`,
          reason: "Child part parentAttachmentId disagrees with the active parent-child connection.",
          conditionEvaluated: "Verified part.parentAttachmentId matches incoming attachment connection ID.",
          correctiveAction: "Re-attach component or run assembly sanitization to synchronize attachment IDs.",
        });
      }
    }

    if (part.type === "Motor") {
      if (foundation) {
        const support = resolveMotorMechanicalSupport(part, parts, connections, foundation);
        const parentConn = connectionByChildId.get(part.id);
        const parentPart = parentConn
          ? partMap.get(parentConn.parentId ?? parentConn.sourceId)
          : undefined;

        if (!support.supported) {
          pushDiagnostic({
            id: `motor-unmounted-${part.id}`,
            severity: "error",
            code: "motor-mount-issue",
            partId: part.id,
            subsystem: "motors",
            title: "Motor not anchored to foundation",
            message: `${part.name} is not mechanically anchored to the foundation (${support.mountingLocation}).`,
            reason: "Motors require either a valid foundation mount zone or an anchored structural carrier reaching foundation-chassis.",
            conditionEvaluated: "Evaluated resolveMotorMechanicalSupport ancestry chain.",
            correctiveAction: "Attach motor to a foundation mount zone or an anchored structural rail/bracket.",
          });
        } else {
          const mountEval = evaluateMotorMountCompatibility({
            motor: part,
            parentPart,
            foundation,
          });
          for (const check of mountEval.checks) {
            if (check.status === "warning" || check.status === "error") {
              pushDiagnostic({
                id: `${check.id}-${part.id}`,
                severity: check.status === "error" ? "error" : "warning",
                code: "motor-mount-issue",
                partId: part.id,
                relatedPartId: parentPart?.id,
                subsystem: "motors",
                title: "Motor mounting check",
                message: check.message,
                reason: check.assumption ?? check.message,
                conditionEvaluated: `Motor mount check (${check.aspect})`,
                correctiveAction: check.correctiveAction,
                provenanceMethod: check.provenance?.method,
              });
            }
          }
        }
      }

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
          subsystem: "wheelsAndDrivetrain",
          title: "Motor without mounted wheel",
          message: `${part.name} does not yet have a wheel mounted on its output shaft.`,
          reason: "Motor has no Motor-Wheel shaft connection.",
          conditionEvaluated: "Checked Motor-Wheel connections referencing this motor.",
          correctiveAction: "Assign a compatible wheel to this motor in Step 6 (Wheels).",
        });
      }
    }

    if (part.type === "Wheel") {
      const motorConn = connections.find(
        (c) =>
          c.type === "Motor-Wheel" &&
          (c.childId ?? c.targetId) === part.id &&
          partMap.has(c.parentId ?? c.sourceId)
      );
      const motorPart = motorConn
        ? partMap.get(motorConn.parentId ?? motorConn.sourceId)
        : undefined;

      if (!motorPart) {
        pushDiagnostic({
          id: `wheel-unattached-${part.id}`,
          severity: "warning",
          code: "wheel-unattached",
          partId: part.id,
          subsystem: "wheelsAndDrivetrain",
          title: "Unattached wheel",
          message: `${part.name} is not connected to a drive motor shaft.`,
          reason: "Unconnected wheels do not transmit drive torque or join drivetrain groups.",
          conditionEvaluated: "Checked Motor-Wheel link on Wheel part.",
          correctiveAction: "Mount this wheel to an installed motor in Step 6 (Wheels).",
        });
      } else {
        const mwEval = evaluateMotorWheelCompatibility({
          motor: motorPart,
          wheel: part,
          foundation,
        });
        for (const check of mwEval.checks) {
          if (check.status === "error") {
            pushDiagnostic({
              id: `${check.id}-${part.id}`,
              severity: "error",
              code: "incompatible-interface",
              partId: part.id,
              relatedPartId: motorPart.id,
              subsystem: "wheelsAndDrivetrain",
              title: "Motor-wheel mismatch",
              message: check.message,
              reason: check.assumption ?? check.message,
              conditionEvaluated: `Motor-wheel compatibility (${check.aspect})`,
              correctiveAction: check.correctiveAction,
              provenanceMethod: check.provenance?.method,
            });
          } else if (check.status === "warning") {
            pushDiagnostic({
              id: `${check.id}-${part.id}`,
              severity: "warning",
              code: "tight-clearance",
              partId: part.id,
              relatedPartId: motorPart.id,
              subsystem: "wheelsAndDrivetrain",
              title: "Wheel sidewall clearance",
              message: check.message,
              reason: check.assumption ?? check.message,
              conditionEvaluated: "Cylindrical sidewall clearance vs chassis half-width",
              correctiveAction: check.correctiveAction,
              provenanceMethod: check.provenance?.method,
            });
          } else if (check.status === "unknown") {
            pushDiagnostic({
              id: `${check.id}-${part.id}`,
              severity: "info",
              code: "unknown-compatibility",
              partId: part.id,
              relatedPartId: motorPart.id,
              subsystem: "compatibility",
              title: "Unverified shaft-hub fit",
              message: check.message,
              reason: check.assumption ?? "Shaft/hub CAD bore specs unavailable in catalogue presets.",
              conditionEvaluated: "Evaluated ShaftInterface vs HubInterface specifications.",
              correctiveAction: "Verify physical hub bore against motor shaft dimensions before fabrication.",
              isUnknownAssumption: true,
              provenanceMethod: "unknown",
            });
          }
        }
      }
    }
  }

  // Detect all single-node and multi-node cycles across valid connections
  const visitState = new Map<string, 0 | 1 | 2>();
  const dfsStack: string[] = [];
  const emittedCycleKeys = new Set<string>();

  const recordCycle = (cycleNodes: readonly string[]) => {
    if (cycleNodes.length === 0) return;
    let minIdx = 0;
    for (let i = 1; i < cycleNodes.length; i++) {
      if (cycleNodes[i] < cycleNodes[minIdx]) minIdx = i;
    }
    const canonical = [
      ...cycleNodes.slice(minIdx),
      ...cycleNodes.slice(0, minIdx),
    ];
    const key = canonical.join("->");
    if (emittedCycleKeys.has(key)) return;
    emittedCycleKeys.add(key);

    const names = canonical.map((id) => partMap.get(id)?.name ?? id);
    const loopLabel =
      canonical.length === 1
        ? `${names[0]} (${canonical[0]})`
        : `${names.join(" -> ")} -> ${names[0]}`;
    pushDiagnostic({
      id: `cycle-${key}`,
      severity: "error",
      code: "circular-attachment",
      partId: canonical[0],
      relatedPartId: canonical[canonical.length - 1],
      affectedPartIds: canonical,
      subsystem: "structural",
      title: "Circular dependency",
      message: `Circular attachment detected involving ${loopLabel}.`,
      reason: "Component attachment graph contains a closed ancestor cycle.",
      conditionEvaluated: "Directed DFS cycle detection across Mechanical and Motor-Wheel connections.",
      correctiveAction: "Detach cycle-forming component(s) and re-attach cleanly below foundation-chassis.",
    });
  };

  const dfsCycle = (nodeId: string) => {
    visitState.set(nodeId, 1);
    dfsStack.push(nodeId);

    for (const nextId of outgoingByParent.get(nodeId) ?? []) {
      const nextState = visitState.get(nextId) ?? 0;
      if (nextState === 1) {
        const startIdx = dfsStack.indexOf(nextId);
        if (startIdx >= 0) {
          recordCycle(dfsStack.slice(startIdx));
        }
      } else if (nextState === 0) {
        dfsCycle(nextId);
      }
    }

    dfsStack.pop();
    visitState.set(nodeId, 2);
  };

  for (const part of parts) {
    if ((visitState.get(part.id) ?? 0) === 0) {
      dfsCycle(part.id);
    }
  }

  // Validate connections (dangling links + reusable compatibility engine)
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
        subsystem: "compatibility",
        title: "Dangling connection",
        message: `Connection "${conn.id}" references a missing component.`,
        reason: "Attachment link points to a deleted or missing part ID.",
        conditionEvaluated: "Verified parentId and childId presence in parts list.",
        correctiveAction: "Remove orphaned connection or undo recent deletion.",
      });
      continue;
    }

    if (conn.type === "Mechanical") {
      const parentInterfaces = resolvePartMountingInterfaces(parentPart, foundation);
      const childInterfaces = resolvePartMountingInterfaces(childPart, foundation);
      const pIface = parentInterfaces.find((i) => i.id === conn.parentMountPointId);
      const cIface = childInterfaces.find((i) => i.id === conn.childMountPointId);

      const isLegacyBuiltInMount =
        conn.parentMountPointId === "foundation-zone" ||
        conn.parentMountPointId === "foundation-chassis";

      if (!isLegacyBuiltInMount && pIface && cIface) {
        const compat = evaluateComponentAttachmentCompatibility({
          childPart,
          parentPart,
          parentInterface: pIface,
          childInterface: cIface,
          foundation,
          existingConnections: connections,
        });

        for (const check of compat.checks) {
          if (check.status === "error") {
            pushDiagnostic({
              id: `compat-${conn.id}-${check.id}`,
              severity: "warning",
              code: "incompatible-interface",
              partId: childPart.id,
              relatedPartId: parentPart.id,
              subsystem: "compatibility",
              title: "Incompatible mounting interface",
              message: `${childPart.name} → ${parentPart.name}: ${check.message}`,
              reason: check.assumption ?? check.message,
              conditionEvaluated: `Attachment compatibility check (${check.aspect})`,
              correctiveAction: check.correctiveAction,
              provenanceMethod: check.provenance?.method,
            });
          } else if (check.status === "warning") {
            pushDiagnostic({
              id: `compat-warn-${conn.id}-${check.id}`,
              severity: "warning",
              code: "incompatible-interface",
              partId: childPart.id,
              relatedPartId: parentPart.id,
              subsystem: "compatibility",
              title: "Attachment fit advisory",
              message: `${childPart.name} → ${parentPart.name}: ${check.message}`,
              reason: check.assumption ?? check.message,
              conditionEvaluated: `Attachment compatibility check (${check.aspect})`,
              correctiveAction: check.correctiveAction,
              provenanceMethod: check.provenance?.method,
            });
          } else if (check.status === "unknown") {
            pushDiagnostic({
              id: `compat-unk-${conn.id}-${check.id}`,
              severity: "info",
              code: "unknown-compatibility",
              partId: childPart.id,
              relatedPartId: parentPart.id,
              subsystem: "compatibility",
              title: "Unverified interface contract",
              message: `${childPart.name} → ${parentPart.name}: ${check.message}`,
              reason: check.assumption ?? "Interface compatibility metadata missing.",
              conditionEvaluated: `Interface contract check (${check.aspect})`,
              isUnknownAssumption: true,
              provenanceMethod: "unknown",
            });
          }
        }
      } else if (!isLegacyBuiltInMount && (!pIface || !cIface)) {
        pushDiagnostic({
          id: `compat-unverified-${conn.id}`,
          severity: "info",
          code: "unknown-compatibility",
          partId: childPart.id,
          relatedPartId: parentPart.id,
          subsystem: "compatibility",
          title: "Unverified attachment metadata",
          message: `${childPart.name} attachment uses unverified interface metadata.`,
          reason: "Mounted interface ID not found on parent or child interface list.",
          conditionEvaluated: "Looked up parentMountPointId and childMountPointId.",
          correctiveAction: "Re-attach component using a known mounting interface in Part Inspector.",
          isUnknownAssumption: true,
          provenanceMethod: "unknown",
        });
      }
    }
  }

  // Exact 15-axis 3D OBB SAT interference & tight wheel clearance check
  const overlapThresholdM = 0.025;
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i];
    for (let j = i + 1; j < parts.length; j++) {
      const b = parts[j];
      if (isIntentionalContactPair(a, b, connections)) continue;

      const depth = computeObbOverlapDepth3D(a, b);
      if (depth > overlapThresholdM) {
        pushDiagnostic({
          id: `overlap-${a.id}-${b.id}`,
          severity: "warning",
          code: "component-overlap",
          partId: a.id,
          relatedPartId: b.id,
          subsystem: "structural",
          title: "3D geometric interference",
          message: `${a.name} overlaps ${b.name} by ~${(depth * 100).toFixed(1)} cm.`,
          reason: "15-axis 3D Oriented Bounding Box SAT detected physical envelope penetration.",
          conditionEvaluated: "computeObbOverlapDepth3D > 2.5 cm",
          correctiveAction: "Adjust part Position, Rotation, or Scale in Inspector to separate geometries.",
        });
      } else if (a.type === "Wheel" && b.type === "Wheel") {
        // Check tight wheel-to-wheel separation when placed on the same side
        const dx = a.position[0] - b.position[0];
        const dy = a.position[1] - b.position[1];
        const dz = a.position[2] - b.position[2];
        const distXZ = Math.hypot(dx, dz);
        const cylA = getPartCylinderDimensions(a);
        const cylB = getPartCylinderDimensions(b);
        const minPitch = cylA.radius + cylB.radius;
        if (Math.abs(dy) < Math.max(cylA.radius, cylB.radius) && distXZ - minPitch < 0.015) {
          pushDiagnostic({
            id: `wheel-gap-${a.id}-${b.id}`,
            severity: "warning",
            code: "tight-clearance",
            partId: a.id,
            relatedPartId: b.id,
            subsystem: "wheelsAndDrivetrain",
            title: "Tight wheel-to-wheel clearance",
            message: `${a.name} and ${b.name} have tight tyre clearance (${((distXZ - minPitch) * 100).toFixed(1)} cm).`,
            reason: "Cylindrical tyre envelopes nearly touch or rub along robot wheel track.",
            conditionEvaluated: "Wheel center-to-center distance vs combined tyre radii (< 1.5 cm gap).",
            correctiveAction: "Reduce wheel diameters slightly or widen motor longitudinal spacing.",
          });
        }
      }
    }
  }

  // Drivetrain completeness advisory when configured or motors exist
  if (foundation && drivetrain) {
    const hasMotorsOrWheels = parts.some(
      (p) => p.type === "Motor" || p.type === "Wheel"
    );
    const hasAnyAssignment =
      drivetrain.left.some(Boolean) || drivetrain.right.some(Boolean);
    if (hasMotorsOrWheels || hasAnyAssignment) {
      const dv = validateDrivetrain(drivetrain, parts, connections, foundation);
      if (!dv.isValid) {
        const referencesMissingPart = dv.errors.some((e) =>
          e.includes("no longer installed")
        );
        pushDiagnostic({
          id: "drivetrain-incomplete",
          severity: referencesMissingPart ? "error" : "warning",
          code: "drivetrain-invalid",
          subsystem: "wheelsAndDrivetrain",
          title: "Drivetrain configuration incomplete",
          message: dv.errors[0] ?? "Drivetrain configuration requires valid left & right powered wheels.",
          reason: dv.errors.join(" "),
          conditionEvaluated: "Evaluated validateDrivetrain left/right drive groups and anchored support.",
          correctiveAction: "Review Step 7 (Drivetrain) or Auto-Map Valid Wheels.",
        });
      }
    }
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info");

  const subsystems: SubsystemHealthSummary[] = [
    summarizeSubsystem(
      "foundation",
      "Foundation",
      diagnostics,
      foundation?.confirmed
        ? "Foundation chassis confirmed and active."
        : "Foundation ready for confirmation."
    ),
    summarizeSubsystem(
      "structural",
      "Structural & Clearance",
      diagnostics,
      "All structural mounts anchored cleanly with no 3D OBB interference."
    ),
    summarizeSubsystem(
      "motors",
      "Motors",
      diagnostics,
      parts.some((p) => p.type === "Motor")
        ? "All drive motors mechanically anchored with proper shaft alignment."
        : "No drive motors installed yet."
    ),
    summarizeSubsystem(
      "wheelsAndDrivetrain",
      "Wheels & Drivetrain",
      diagnostics,
      "Drivetrain and wheel assemblies valid."
    ),
    summarizeSubsystem(
      "compatibility",
      "Compatibility & Specs",
      diagnostics,
      "All mounting interface contracts verified cleanly."
    ),
  ];

  let healthStatus: SubsystemHealthStatus = "healthy";
  if (errors.length > 0) healthStatus = "error";
  else if (warnings.length > 0) healthStatus = "warning";
  else if (diagnostics.some((d) => d.isUnknownAssumption)) healthStatus = "unknown";

  const byPart: Record<string, AssemblyDiagnostic[]> = {};
  for (const diag of diagnostics) {
    const indexedIds = new Set<string>();
    if (diag.partId) indexedIds.add(diag.partId);
    if (diag.relatedPartId) indexedIds.add(diag.relatedPartId);
    for (const affectedId of diag.affectedPartIds ?? []) {
      if (affectedId) indexedIds.add(affectedId);
    }
    for (const id of indexedIds) {
      (byPart[id] ??= []).push(diag);
    }
  }

  const electricalReport = validateElectricalAssembly({
    parts,
    electricalConnections,
  });

  return {
    isValid: errors.length === 0,
    healthStatus,
    errors,
    warnings,
    infos,
    diagnostics,
    diagnosticsByPartId: byPart,
    subsystems,
    electricalReport,
    assemblyBounds: parts.length
      ? { minX, maxX, minY, maxY, minZ, maxZ }
      : { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
  };
}
