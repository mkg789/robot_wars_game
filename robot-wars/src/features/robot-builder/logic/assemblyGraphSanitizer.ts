import { Euler, Vector3 } from "three";
import { getElectricalCatalogueItem } from "../../electrical/data/electricalCatalogue";
import { resolvePartElectricalSpec } from "../../electrical/logic/electricalComponentAdapters";
import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type {
  BuildStage,
  DrivetrainConfiguration,
  FoundationConfig,
  ImportedMeshTransform,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";
import { buildCustomCollisionConfig, resolveImportedEngineeringProperties } from "./customCollision";
import { retainValidDrivetrainAssignments } from "./drivetrain";
import { getPartBoxExtents } from "./geometryAdapters";
import { getMeshAssetRecord } from "./meshAssetRegistry";
import { getMotorShaftMountOffset } from "./mounting";
import {
  composeEulerRotations,
  computeAttachedChildTransform,
  hasAttachmentCycle,
  resolvePartMountingInterfaces,
} from "./mountingInterfaces";
import { STL_UNIT_TO_METERS } from "./stlParser";

export interface AssemblyGraphStateInput {
  readonly parts: readonly RobotPart[];
  readonly connections: readonly RobotConnection[];
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly foundation: FoundationConfig | null;
  readonly foundationId: string | null;
  readonly drivetrain: DrivetrainConfiguration;
  readonly hiddenPartIds: readonly string[];
  readonly selectedId: string | null;
  readonly selectedWheelMotorId: string | null;
  readonly selectedElectricalConnectionId: string | null;
  readonly selectedElectricalPinId: string | null;
  readonly stage?: BuildStage;
}

export interface SanitizedAssemblyGraphResult {
  readonly parts: RobotPart[];
  readonly connections: RobotConnection[];
  readonly electricalConnections: ElectricalConnection[];
  readonly foundation: FoundationConfig | null;
  readonly foundationId: string | null;
  readonly drivetrain: DrivetrainConfiguration;
  readonly hiddenPartIds: string[];
  readonly selectedId: string | null;
  readonly selectedWheelMotorId: string | null;
  readonly selectedElectricalConnectionId: string | null;
  readonly selectedElectricalPinId: string | null;
  readonly stage?: BuildStage;
}

/**
 * Normalizes and enforces referential integrity across mechanical parts, connections,
 * drivetrain assignments, electrical wiring, foundation links, and active UI selections.
 */
export function sanitizeAssemblyGraph(
  input: AssemblyGraphStateInput
): SanitizedAssemblyGraphResult {
  const partIds = new Set(input.parts.map((p) => p.id));
  const partsById = new Map(input.parts.map((p) => [p.id, p]));

  // 1. Clean mechanical connections: existing endpoints, no self-loops, unique parent per child, acyclic
  const cleanConnections: RobotConnection[] = [];
  const childConnectionMap = new Map<string, RobotConnection>();

  for (const conn of input.connections) {
    const parentId = conn.parentId ?? conn.sourceId;
    const childId = conn.childId ?? conn.targetId;
    if (!parentId || !childId || parentId === childId) continue;
    if (!partIds.has(parentId) || !partIds.has(childId)) continue;
    if (childConnectionMap.has(childId)) continue;
    if (hasAttachmentCycle(cleanConnections, parentId, childId)) continue;

    const normalized: RobotConnection = {
      ...conn,
      sourceId: parentId,
      targetId: childId,
      parentId,
      childId,
    };
    cleanConnections.push(normalized);
    childConnectionMap.set(childId, normalized);
  }

  // 2. Synchronize part.parentAttachmentId with surviving parent-child connections
  const cleanParts: RobotPart[] = input.parts.map((part) => {
    const incoming = childConnectionMap.get(part.id);
    const expectedAttachmentId = incoming?.id;
    if (part.parentAttachmentId === expectedAttachmentId) {
      return part;
    }
    return {
      ...part,
      parentAttachmentId: expectedAttachmentId,
    };
  });

  // 3. Synchronize foundation state when foundation root or generated plates were removed
  const hasFoundationRoot = partIds.has("foundation-chassis");
  let nextFoundation = input.foundation;
  let nextFoundationId = hasFoundationRoot
    ? (input.foundationId ?? "foundation-chassis")
    : null;
  let nextStage = input.stage;

  if (!hasFoundationRoot) {
    nextFoundation = null;
    nextFoundationId = null;
    if (nextStage) nextStage = "foundation";
  } else if (nextFoundation) {
    const hasTopPlate = partIds.has("foundation-top-plate");
    const hasFrontCover = partIds.has("foundation-front-cover");
    if (
      (nextFoundation.includeTopPlate && !hasTopPlate) ||
      (nextFoundation.includeFrontCover && !hasFrontCover)
    ) {
      nextFoundation = {
        ...nextFoundation,
        includeTopPlate: nextFoundation.includeTopPlate && hasTopPlate,
        includeFrontCover: nextFoundation.includeFrontCover && hasFrontCover,
      };
    }
  }

  // 4. Filter electrical connections against surviving parts AND their current resolved electrical interfaces
  const validInterfaceIdsByPart = new Map<string, Set<string>>();
  for (const part of cleanParts) {
    const spec = resolvePartElectricalSpec(part);
    if (spec) {
      validInterfaceIdsByPart.set(
        part.id,
        new Set(spec.interfaces.map((iface) => iface.interfaceId))
      );
    }
  }

  const cleanElectricalConnections = input.electricalConnections.filter((conn) => {
    const srcPart = partsById.get(conn.sourcePartId);
    const dstPart = partsById.get(conn.targetPartId);
    if (!srcPart || !dstPart) return false;
    const srcIfaces = validInterfaceIdsByPart.get(conn.sourcePartId);
    const dstIfaces = validInterfaceIdsByPart.get(conn.targetPartId);
    if (!srcIfaces || !dstIfaces) return false;
    return (
      srcIfaces.has(conn.sourceInterfaceId) &&
      dstIfaces.has(conn.targetInterfaceId)
    );
  });

  // 5. Revalidate drivetrain, visibility, and active selections
  const nextDrivetrain = hasFoundationRoot
    ? retainValidDrivetrainAssignments(
        input.drivetrain,
        cleanParts,
        cleanConnections,
        nextFoundation
      )
    : {
        ...input.drivetrain,
        left: input.drivetrain.left.map(() => null),
        right: input.drivetrain.right.map(() => null),
      };

  const nextHiddenPartIds = input.hiddenPartIds.filter((id) => partIds.has(id));

  const nextSelectedId =
    input.selectedId && partIds.has(input.selectedId)
      ? input.selectedId
      : nextFoundationId;

  const selectedMotor = input.selectedWheelMotorId
    ? partsById.get(input.selectedWheelMotorId)
    : undefined;
  const nextSelectedWheelMotorId =
    selectedMotor && selectedMotor.type === "Motor"
      ? selectedMotor.id
      : null;

  const selectedElecConnExists =
    input.selectedElectricalConnectionId &&
    cleanElectricalConnections.some(
      (c) => c.id === input.selectedElectricalConnectionId
    );
  const nextSelectedElectricalConnectionId = selectedElecConnExists
    ? input.selectedElectricalConnectionId
    : null;

  const selectedPartPins = nextSelectedId
    ? resolvePartElectricalSpec(partsById.get(nextSelectedId)!)?.pins
    : undefined;
  const nextSelectedElectricalPinId =
    input.selectedElectricalPinId &&
    selectedPartPins?.some((pin) => pin.pinId === input.selectedElectricalPinId)
      ? input.selectedElectricalPinId
      : null;

  return {
    parts: cleanParts,
    connections: cleanConnections,
    electricalConnections: cleanElectricalConnections,
    foundation: nextFoundation,
    foundationId: nextFoundationId,
    drivetrain: nextDrivetrain,
    hiddenPartIds: nextHiddenPartIds,
    selectedId: nextSelectedId,
    selectedWheelMotorId: nextSelectedWheelMotorId,
    selectedElectricalConnectionId: nextSelectedElectricalConnectionId,
    selectedElectricalPinId: nextSelectedElectricalPinId,
    ...(nextStage !== undefined ? { stage: nextStage } : {}),
  };
}

/**
 * Re-anchors child mounting offsets when a parent part's dimensions/geometry change,
 * preserving any user-applied local offset delta relative to the mounting face.
 */
export function reanchorMountedChildrenOnParentResize(params: {
  readonly prevParts: readonly RobotPart[];
  readonly nextParts: readonly RobotPart[];
  readonly connections: readonly RobotConnection[];
  readonly resizedPartIds: readonly string[];
  readonly foundation: FoundationConfig | null;
}): RobotConnection[] {
  const { prevParts, nextParts, connections, resizedPartIds, foundation } = params;
  if (resizedPartIds.length === 0) return [...connections];

  const resizedSet = new Set(resizedPartIds);
  const prevById = new Map(prevParts.map((p) => [p.id, p]));
  const nextById = new Map(nextParts.map((p) => [p.id, p]));

  return connections.map((conn) => {
    const parentId = conn.parentId ?? conn.sourceId;
    const childId = conn.childId ?? conn.targetId;
    if (!resizedSet.has(parentId)) return conn;
    if (conn.id.startsWith("conn-foundation-member-")) return conn;

    const prevParent = prevById.get(parentId);
    const nextParent = nextById.get(parentId);
    const child = nextById.get(childId);
    if (!prevParent || !nextParent || !child) return conn;

    if (conn.type === "Motor-Wheel" && nextParent.type === "Motor") {
      const prevShaft = getMotorShaftMountOffset(prevParent);
      const nextShaft = getMotorShaftMountOffset(nextParent);
      const curRel = conn.relativePosition ?? prevShaft;
      return {
        ...conn,
        relativePosition: [
          curRel[0] + (nextShaft[0] - prevShaft[0]),
          curRel[1] + (nextShaft[1] - prevShaft[1]),
          curRel[2] + (nextShaft[2] - prevShaft[2]),
        ],
        wheelOffset: nextShaft,
      };
    }

    if (conn.type !== "Mechanical") return conn;

    const prevIfaces = resolvePartMountingInterfaces(prevParent, foundation);
    const nextIfaces = resolvePartMountingInterfaces(nextParent, foundation);
    const childIfaces = resolvePartMountingInterfaces(child, foundation);
    const prevParentIface = prevIfaces.find(
      (i) => i.id === conn.parentMountPointId
    );
    const nextParentIface = nextIfaces.find(
      (i) => i.id === conn.parentMountPointId
    );
    const childIface =
      childIfaces.find((i) => i.id === conn.childMountPointId) ??
      childIfaces[0];

    if (!prevParentIface || !nextParentIface || !childIface) {
      return conn;
    }

    const oldAttached = computeAttachedChildTransform(
      prevParent,
      prevParentIface,
      child,
      childIface
    );
    const newAttached = computeAttachedChildTransform(
      nextParent,
      nextParentIface,
      child,
      childIface
    );
    const curRel = conn.relativePosition ?? oldAttached.relativePosition;

    return {
      ...conn,
      relativePosition: [
        curRel[0] +
          (newAttached.relativePosition[0] - oldAttached.relativePosition[0]),
        curRel[1] +
          (newAttached.relativePosition[1] - oldAttached.relativePosition[1]),
        curRel[2] +
          (newAttached.relativePosition[2] - oldAttached.relativePosition[2]),
      ],
    };
  });
}

/**
 * Synchronizes an imported STL part's meshTransform, collision proxy bounds, and
 * engineering properties (estimated mass, local CoM, cuboid inertia) whenever its local size changes.
 */
export function syncImportedPartFromSize(
  part: RobotPart,
  nextLocalSize: readonly [number, number, number]
): Partial<RobotPart> {
  if (!part.meshAssetId) return {};

  const asset = getMeshAssetRecord(part.meshAssetId);
  const prevExtents = getPartBoxExtents(part);
  const rawDims = asset?.inspection.rawDimensions;

  let nextTransform: ImportedMeshTransform | undefined = part.meshTransform
    ? { ...part.meshTransform }
    : undefined;

  if (nextTransform) {
    const unitFactor = STL_UNIT_TO_METERS[nextTransform.unit];
    let nextScale: [number, number, number];
    if (
      rawDims &&
      rawDims[0] > 1e-6 &&
      rawDims[1] > 1e-6 &&
      rawDims[2] > 1e-6
    ) {
      nextScale = [
        Math.max(1e-4, nextLocalSize[0] / (rawDims[0] * unitFactor)),
        Math.max(1e-4, nextLocalSize[1] / (rawDims[1] * unitFactor)),
        Math.max(1e-4, nextLocalSize[2] / (rawDims[2] * unitFactor)),
      ];
    } else {
      const baseScale =
        nextTransform.scaleMode === "uniform"
          ? ([
              nextTransform.uniformScale,
              nextTransform.uniformScale,
              nextTransform.uniformScale,
            ] as const)
          : nextTransform.nonUniformScale;
      nextScale = [
        Math.max(1e-4, baseScale[0] * (nextLocalSize[0] / Math.max(1e-5, prevExtents[0]))),
        Math.max(1e-4, baseScale[1] * (nextLocalSize[1] / Math.max(1e-5, prevExtents[1]))),
        Math.max(1e-4, baseScale[2] * (nextLocalSize[2] / Math.max(1e-5, prevExtents[2]))),
      ];
    }

    const isUniform =
      Math.abs(nextScale[0] - nextScale[1]) < 1e-5 &&
      Math.abs(nextScale[1] - nextScale[2]) < 1e-5;
    nextTransform = {
      ...nextTransform,
      scaleMode: isUniform ? "uniform" : "non-uniform",
      uniformScale: isUniform ? nextScale[0] : nextTransform.uniformScale,
      nonUniformScale: nextScale,
    };
  }

  let nextEngineering = part.importedEngineering;
  if (asset && nextTransform && part.importedEngineering) {
    nextEngineering = resolveImportedEngineeringProperties({
      inspection: asset.inspection,
      transform: nextTransform,
      materialId: part.importedEngineering.materialId,
      customDensityKgM3: part.importedEngineering.materialDensityKgM3,
      massMode: part.importedEngineering.massMode,
      userMassKg: part.importedEngineering.massKg,
      centerOfMassMode: part.importedEngineering.centerOfMassMode,
      userCenterOfMassLocal:
        part.importedEngineering.centerOfMassMode === "user"
          ? part.importedEngineering.centerOfMassLocal
          : undefined,
      inertiaMode: part.importedEngineering.inertiaMode,
      userInertiaKgM2:
        part.importedEngineering.inertiaMode === "user"
          ? part.importedEngineering.inertiaKgM2
          : undefined,
    });
  }

  const nextCollision = part.collisionConfig
    ? buildCustomCollisionConfig({
        mode: part.collisionConfig.mode,
        extents: nextLocalSize,
        assetId: part.meshAssetId,
        customBoxes:
          part.collisionConfig.mode === "single-box"
            ? part.collisionConfig.boxes
            : undefined,
      })
    : undefined;

  const resolvedMass =
    nextEngineering?.massKg !== undefined && nextEngineering.massKg > 0
      ? nextEngineering.massKg
      : (part.massKg ?? part.mass);

  return {
    ...(nextTransform ? { meshTransform: nextTransform } : {}),
    ...(nextEngineering ? { importedEngineering: nextEngineering } : {}),
    ...(nextCollision ? { collisionConfig: nextCollision } : {}),
    mass: resolvedMass,
    massKg: resolvedMass,
    customInertiaKgM2: nextEngineering?.inertiaKgM2
      ? [...nextEngineering.inertiaKgM2]
      : undefined,
  };
}

/** Ensures structural replacement strips any leftover electrical catalogue metadata if inapplicable */
export function buildReplacementElectricalFields(
  existingPart: RobotPart
): Pick<
  RobotPart,
  "electricalCatalogueId" | "electrical" | "electricalSpec"
> {
  if (
    existingPart.electricalCatalogueId &&
    getElectricalCatalogueItem(existingPart.electricalCatalogueId)
  ) {
    return {};
  }
  return {
    electricalCatalogueId: undefined,
    electrical: undefined,
    electricalSpec: undefined,
  };
}

/**
 * Propagates parent-to-child mechanical/motor-wheel world transforms along an acyclic attachment graph.
 */
export function syncAssemblyTransforms(
  parts: RobotPart[],
  connections: RobotConnection[]
): RobotPart[] {
  const synchronized = new Map(parts.map((part) => [part.id, { ...part }]));
  const childrenByParent = new Map<string, RobotConnection[]>();

  for (const connection of connections) {
    const parentId = connection.parentId ?? connection.sourceId;
    const childId = connection.childId ?? connection.targetId;
    if (!synchronized.has(parentId) || !synchronized.has(childId)) continue;
    childrenByParent.set(parentId, [
      ...(childrenByParent.get(parentId) ?? []),
      { ...connection, parentId, childId },
    ]);
  }

  const visited = new Set<string>();
  const applyChildren = (parentId: string) => {
    if (visited.has(parentId)) return;
    visited.add(parentId);

    const parent = synchronized.get(parentId);
    if (!parent) return;

    for (const connection of childrenByParent.get(parentId) ?? []) {
      const child = synchronized.get(connection.childId);
      if (!child) continue;

      const parentRot = parent.rotation ?? [0, 0, 0];
      const storedRelative =
        connection.relativePosition ??
        (parent.type === "Motor" ? getMotorShaftMountOffset(parent) : [0, 0, 0]);
      const worldOffset = new Vector3(...storedRelative).applyEuler(
        new Euler(parentRot[0], parentRot[1], parentRot[2], "XYZ")
      );

      const position: [number, number, number] = [
        parent.position[0] + worldOffset.x,
        parent.position[1] + worldOffset.y,
        parent.position[2] + worldOffset.z,
      ];
      const relativeRotation = connection.relativeRotation ?? [0, 0, 0];
      const rotation = composeEulerRotations(parentRot, relativeRotation);

      synchronized.set(connection.childId, {
        ...child,
        position,
        rotation,
        parentAttachmentId: connection.id,
      });
      applyChildren(connection.childId);
    }
  };

  for (const part of synchronized.values()) {
    const isChild = connections.some(
      (connection) =>
        (connection.childId ?? connection.targetId) === part.id
    );
    if (!isChild) applyChildren(part.id);
  }

  return parts.map((part) => synchronized.get(part.id) ?? part);
}

/**
 * Collects all unique STL meshAssetIds referenced by a robot snapshot's parts or imported foundation.
 */
export function collectSnapshotMeshAssetIds(
  parts: readonly RobotPart[],
  foundation: FoundationConfig | null,
  target: Set<string>
): void {
  for (const part of parts) {
    if (part.meshAssetId) {
      target.add(part.meshAssetId);
    }
  }
  if (foundation?.imported?.assetId) {
    target.add(foundation.imported.assetId);
  }
}
