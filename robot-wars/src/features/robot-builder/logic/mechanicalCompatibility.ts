import { Euler, Vector3 } from "three";
import { motorCatalogue } from "../data/motorCatalogue";
import { wheelCatalogue } from "../data/wheelCatalogue";
import type { ProvenanceMeta } from "../types/engineering.types";
import type {
  AttachmentCompatibilityStatus,
  AttachmentInterface,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";
import {
  getPartBoundingExtents,
  getPartBoxExtents,
  getPartCylinderDimensions,
} from "./geometryAdapters";
import {
  evaluateInterfaceCompatibility,
  hasAttachmentCycle,
  resolvePartMountingInterfaces,
} from "./mountingInterfaces";

export type CompatibilityCheckSeverity = "pass" | "warning" | "error" | "unknown";

export interface MechanicalCompatibilityCheck {
  readonly id: string;
  readonly aspect:
    | "interface-type"
    | "dimension-fit"
    | "orientation-alignment"
    | "surface-clearance"
    | "structural-load"
    | "shaft-hub-fit"
    | "cycle-guard"
    | "catalogue-compatibility";
  readonly status: CompatibilityCheckSeverity;
  readonly message: string;
  readonly assumption?: string;
  readonly provenance?: ProvenanceMeta;
  readonly correctiveAction?: string;
}

export interface MechanicalCompatibilityEvaluation {
  readonly status: AttachmentCompatibilityStatus;
  readonly summary: string;
  readonly provenanceState: "verified" | "estimated" | "mixed" | "unknown";
  readonly checks: readonly MechanicalCompatibilityCheck[];
  readonly assumptions: readonly string[];
}

export interface ReplacementCompatibilityImpact {
  readonly overallStatus: AttachmentCompatibilityStatus;
  readonly affectedChildren: readonly {
    readonly childId: string;
    readonly childName: string;
    readonly evaluation: MechanicalCompatibilityEvaluation;
  }[];
  readonly brokenCount: number;
  readonly warningCount: number;
  readonly unknownCount: number;
}

function summarizeStatusFromChecks(
  checks: readonly MechanicalCompatibilityCheck[]
): AttachmentCompatibilityStatus {
  if (checks.some((c) => c.status === "error")) return "incompatible";
  if (checks.some((c) => c.status === "unknown")) return "unknown";
  if (checks.some((c) => c.status === "warning")) {
    return "compatible-with-warnings";
  }
  return "compatible";
}

function summarizeProvenance(
  checks: readonly MechanicalCompatibilityCheck[]
): MechanicalCompatibilityEvaluation["provenanceState"] {
  let hasVerified = false;
  let hasEstimated = false;
  let hasUnknown = false;

  for (const check of checks) {
    const method = check.provenance?.method;
    if (!method || method === "unknown") {
      if (check.status === "unknown") hasUnknown = true;
      else hasEstimated = true;
    } else if (method === "estimated") {
      hasEstimated = true;
    } else {
      hasVerified = true;
    }
  }

  if (hasUnknown && !hasVerified && !hasEstimated) return "unknown";
  if (hasUnknown || (hasVerified && hasEstimated)) return "mixed";
  if (hasVerified) return "verified";
  return "estimated";
}

/**
 * Evaluates full mechanical attachment compatibility between a proposed child component
 * and parent component, factoring interface type match, cycle protection, dimensional fit,
 * payload support, and explicit provenance without fabricating datasheet guarantees.
 */
export function evaluateComponentAttachmentCompatibility(params: {
  readonly childPart: RobotPart;
  readonly parentPart: RobotPart;
  readonly parentInterface?: AttachmentInterface | null;
  readonly childInterface?: AttachmentInterface | null;
  readonly foundation?: FoundationConfig | null;
  readonly existingConnections?: readonly RobotConnection[];
}): MechanicalCompatibilityEvaluation {
  const {
    childPart,
    parentPart,
    foundation,
    existingConnections = [],
  } = params;
  const checks: MechanicalCompatibilityCheck[] = [];
  const assumptions: string[] = [];

  if (childPart.id === "foundation-chassis") {
    checks.push({
      id: "foundation-root-check",
      aspect: "cycle-guard",
      status: "error",
      message: "Primary foundation chassis cannot be mounted as a child of another part.",
      correctiveAction: "Keep foundation-chassis as the assembly root.",
    });
  } else if (parentPart.type === "Wheel") {
    checks.push({
      id: "wheel-parent-check",
      aspect: "interface-type",
      status: "error",
      message: "Rotating wheels cannot serve as structural mounting parents.",
      correctiveAction: "Mount structural components to foundation, rails, plates, or brackets.",
    });
  } else {
    const filtered = existingConnections.filter(
      (c) => (c.childId ?? c.targetId) !== childPart.id
    );
    if (hasAttachmentCycle(filtered, parentPart.id, childPart.id)) {
      checks.push({
        id: "cycle-check",
        aspect: "cycle-guard",
        status: "error",
        message: `Attaching ${childPart.name} to ${parentPart.name} introduces a circular dependency.`,
        correctiveAction: "Select an ancestor component that does not depend on this part.",
      });
    }
  }

  const pInterfaces = resolvePartMountingInterfaces(parentPart, foundation);
  const cInterfaces = resolvePartMountingInterfaces(childPart, foundation);
  const parentIface = params.parentInterface ?? pInterfaces[0] ?? null;
  const childIface = params.childInterface ?? cInterfaces[0] ?? null;

  const ifaceCompat = evaluateInterfaceCompatibility(parentIface, childIface);
  if (ifaceCompat.status === "incompatible") {
    checks.push({
      id: "interface-type-check",
      aspect: "interface-type",
      status: "error",
      message: ifaceCompat.reason,
      provenance: parentIface?.provenance ?? childIface?.provenance,
      correctiveAction: "Choose a compatible interface (e.g. rail-slot, bracket-face, or plate-mount).",
    });
  } else if (ifaceCompat.status === "unknown") {
    checks.push({
      id: "interface-type-check",
      aspect: "interface-type",
      status: "unknown",
      message: ifaceCompat.reason,
      assumption: "Interface metadata incomplete; physical fastener compatibility unverified.",
      provenance: {
        method: "unknown",
        notes: "Missing or unknown interface contract.",
      },
    });
    assumptions.push(ifaceCompat.reason);
  } else {
    checks.push({
      id: "interface-type-check",
      aspect: "interface-type",
      status: "pass",
      message: ifaceCompat.reason,
      provenance: parentIface?.provenance ?? {
        method: "estimated",
        basis: "Workshop interface family matching rule",
      },
    });
  }

  // Dimension & overhang fit check
  const childExtents = getPartBoundingExtents(childPart);
  const parentExtents = getPartBoundingExtents(parentPart);
  const maxAllowedLength =
    parentIface?.dimensionConstraint?.maxLengthM ??
    Math.max(parentExtents[0], parentExtents[2]) * 1.4;
  const maxAllowedWidth =
    parentIface?.dimensionConstraint?.maxWidthM ??
    Math.max(parentExtents[0], parentExtents[2]) * 1.4;

  const childFootprintMax = Math.max(childExtents[0], childExtents[2]);
  const childFootprintMin = Math.min(childExtents[0], childExtents[2]);

  if (
    childFootprintMax > maxAllowedLength * 1.25 ||
    childFootprintMin > maxAllowedWidth * 1.25
  ) {
    const assumption =
      "Evaluated using nominal component bounding envelopes because exact fastener span patterns are unavailable.";
    assumptions.push(assumption);
    checks.push({
      id: "dimension-fit-check",
      aspect: "dimension-fit",
      status: "warning",
      message: `${childPart.name} (${childExtents[0].toFixed(2)}×${childExtents[2].toFixed(2)} m) significantly exceeds "${parentIface?.label ?? parentPart.name}" support span.`,
      assumption,
      provenance: { method: "estimated", basis: "Envelope ratio check (> 1.25× parent support span)" },
      correctiveAction: "Mount onto a larger plate/rail or reduce part length/width.",
    });
  } else {
    checks.push({
      id: "dimension-fit-check",
      aspect: "dimension-fit",
      status: "pass",
      message: `Component footprint fits within "${parentPart.name}" mounting envelope.`,
      provenance: { method: "estimated", basis: "Envelope comparison in SI meters" },
    });
  }

  // Mass / payload heuristic check for slender spacers/standoffs
  const childMassKg = childPart.massKg ?? childPart.mass;
  const maxPayloadKg = parentIface?.dimensionConstraint?.maxPayloadKg;
  if (
    maxPayloadKg !== undefined &&
    Number.isFinite(childMassKg) &&
    childMassKg > maxPayloadKg
  ) {
    const assumption =
      "Payload limit is an estimated Workshop structural heuristic, not a FEA stress limit.";
    assumptions.push(assumption);
    checks.push({
      id: "payload-check",
      aspect: "structural-load",
      status: "warning",
      message: `${childPart.name} (${childMassKg.toFixed(2)} kg) exceeds nominal ${maxPayloadKg.toFixed(1)} kg bracket/mount estimate.`,
      assumption,
      provenance: { method: "estimated", basis: "Heuristic bracket payload limit" },
      correctiveAction: "Attach heavy components directly to foundation chassis or structural box beams.",
    });
  }

  // Wheel / motor coupling verification note when shaft/hub specs are unverified
  if (parentPart.type === "Motor" && childPart.type === "Wheel") {
    const mwEval = evaluateMotorWheelCompatibility({
      motor: parentPart,
      wheel: childPart,
      foundation,
    });
    for (const c of mwEval.checks) {
      if (c.aspect !== "interface-type") {
        checks.push(c);
      }
    }
    assumptions.push(...mwEval.assumptions);
  }

  if (childPart.type === "Motor") {
    const mmEval = evaluateMotorMountCompatibility({
      motor: childPart,
      parentPart,
      parentInterface: parentIface,
      foundation,
    });
    for (const c of mmEval.checks) {
      if (c.aspect !== "interface-type" && c.aspect !== "dimension-fit") {
        checks.push(c);
      }
    }
    assumptions.push(...mmEval.assumptions);
  }

  const status = summarizeStatusFromChecks(checks);
  return {
    status,
    summary:
      checks.find((c) => c.status === "error")?.message ??
      checks.find((c) => c.status === "warning")?.message ??
      checks.find((c) => c.status === "unknown")?.message ??
      checks[0]?.message ??
      "Compatible mounting relationship.",
    provenanceState: summarizeProvenance(checks),
    checks,
    assumptions: Array.from(new Set(assumptions)),
  };
}

/**
 * Evaluates motor mounting suitability, shaft orientation relative to chassis/ground,
 * and structural carrier suitability without fabricating motor/bracket shear specs.
 */
export function evaluateMotorMountCompatibility(params: {
  readonly motor: RobotPart;
  readonly parentPart?: RobotPart | null;
  readonly parentInterface?: AttachmentInterface | null;
  readonly foundation?: FoundationConfig | null;
}): MechanicalCompatibilityEvaluation {
  const { motor, parentPart, foundation } = params;
  const checks: MechanicalCompatibilityCheck[] = [];
  const assumptions: string[] = [];

  if (!parentPart) {
    checks.push({
      id: "motor-unmounted",
      aspect: "interface-type",
      status: "error",
      message: `${motor.name} has no mechanical parent attachment.`,
      correctiveAction: "Mount the motor to a foundation zone or compatible structural rail/bracket.",
    });
  } else {
    const allowedParent =
      parentPart.id === "foundation-chassis" ||
      parentPart.structuralCategory === "rail" ||
      parentPart.structuralCategory === "bracket" ||
      parentPart.structuralCategory === "beam" ||
      parentPart.structuralCategory === "crossbar" ||
      parentPart.structuralCategory === "plate" ||
      parentPart.type === "Structural Block" ||
      parentPart.type === "Armor Plate";

    if (!allowedParent) {
      checks.push({
        id: "motor-parent-type",
        aspect: "interface-type",
        status: "error",
        message: `${motor.name} cannot mount onto ${parentPart.name} (${parentPart.type}).`,
        correctiveAction: "Attach motors to foundation zones, structural rails, or mounting brackets.",
      });
    } else if (
      parentPart.structuralCategory === "spacer" &&
      (motor.massKg ?? motor.mass) > 0.25
    ) {
      checks.push({
        id: "motor-spacer-warning",
        aspect: "structural-load",
        status: "warning",
        message: `${motor.name} mounted onto lightweight spacer "${parentPart.name}" lacks dedicated torque bracing.`,
        assumption: "Workshop stiffness heuristic without FEA torque-reaction analysis.",
        provenance: { method: "estimated", basis: "Spacer/motor stiffness heuristic" },
        correctiveAction: "Mount motor to a structural rail, beam, bracket, or foundation mount zone.",
      });
    } else {
      checks.push({
        id: "motor-parent-ok",
        aspect: "interface-type",
        status: "pass",
        message: `${motor.name} supported mechanically by ${parentPart.name}.`,
        provenance: { method: "estimated", basis: "Verified Workshop structural parent category" },
      });
    }
  }

  // Check motor local +X output shaft direction relative to robot frame (+Z left, -Z right)
  const shaftAxisWorld = new Vector3(1, 0, 0).applyEuler(
    new Euler(...(motor.rotation ?? [0, 0, 0]), "XYZ")
  );
  const lateralAlignment = Math.abs(shaftAxisWorld.z);
  const longitudinalComponent = Math.abs(shaftAxisWorld.x);

  if (lateralAlignment < 0.7 || longitudinalComponent > 0.6) {
    checks.push({
      id: "motor-shaft-orientation",
      aspect: "orientation-alignment",
      status: "warning",
      message: `${motor.name} shaft points fore/aft (|Z|=${lateralAlignment.toFixed(2)}) instead of laterally (±Z) for skid-steer drive.`,
      assumption: "Planar differential drivetrain expects wheel axles perpendicular to +X heading.",
      provenance: { method: "estimated", basis: "Euler XYZ shaft projection check" },
      correctiveAction: "Rotate motor yaw toward ±90° (±π/2 rad) so the output shaft faces left (+Z) or right (-Z).",
    });
  } else if (
    foundation &&
    motor.position[2] * shaftAxisWorld.z < -0.05 &&
    Math.abs(motor.position[2]) > foundation.width * 0.25
  ) {
    checks.push({
      id: "motor-inward-shaft",
      aspect: "surface-clearance",
      status: "warning",
      message: `${motor.name} output shaft faces inward toward chassis centerline, risking wheel-chassis interference.`,
      provenance: { method: "estimated", basis: "Shaft sign vs lateral mounting offset check" },
      correctiveAction: "Use 'Rotate 180°' or adjust Yaw so the shaft points outward away from chassis.",
    });
  } else {
    checks.push({
      id: "motor-orientation-ok",
      aspect: "orientation-alignment",
      status: "pass",
      message: `${motor.name} output shaft aligns laterally for differential wheel drive.`,
      provenance: { method: "estimated", basis: "Euler XYZ shaft axis orientation check" },
    });
  }

  const status = summarizeStatusFromChecks(checks);
  return {
    status,
    summary:
      checks.find((c) => c.status === "error")?.message ??
      checks.find((c) => c.status === "warning")?.message ??
      checks[0]?.message ??
      "Motor mount valid.",
    provenanceState: summarizeProvenance(checks),
    checks,
    assumptions,
  };
}

/**
 * Evaluates mechanical coupling, catalogue compatibility, shaft/hub geometry,
 * axle alignment, and chassis side clearance between a motor and wheel.
 */
export function evaluateMotorWheelCompatibility(params: {
  readonly motor: RobotPart | null | undefined;
  readonly wheel: RobotPart;
  readonly foundation?: FoundationConfig | null;
  readonly parentChassis?: RobotPart | null;
}): MechanicalCompatibilityEvaluation {
  const { motor, wheel, foundation } = params;
  const checks: MechanicalCompatibilityCheck[] = [];
  const assumptions: string[] = [];

  if (!motor) {
    checks.push({
      id: "wheel-no-motor",
      aspect: "interface-type",
      status: "error",
      message: `${wheel.name} is not connected to a drive motor shaft.`,
      correctiveAction: "Assign this wheel to an installed motor in the Wheels stage or Part Inspector.",
    });
    return {
      status: "incompatible",
      summary: checks[0].message,
      provenanceState: "estimated",
      checks,
      assumptions,
    };
  }

  // 1. Catalogue compatibility check (where catalogue IDs are known)
  const wheelDef = wheel.wheelCatalogueId
    ? wheelCatalogue.find((w) => w.id === wheel.wheelCatalogueId)
    : undefined;
  const motorDef = motor.motorCatalogueId
    ? motorCatalogue.find((m) => m.id === motor.motorCatalogueId)
    : undefined;

  if (wheelDef && motor.motorCatalogueId) {
    if (!wheelDef.compatibleMotorIds.includes(motor.motorCatalogueId)) {
      checks.push({
        id: "wheel-motor-catalogue",
        aspect: "catalogue-compatibility",
        status: "error",
        message: `${wheelDef.name} is incompatible with ${motorDef?.name ?? motor.motorCatalogueId}.`,
        provenance: { method: "estimated", basis: "Catalogue motor-wheel pairing matrix" },
        correctiveAction: "Select a compatible wheel preset or motor size.",
      });
    } else {
      checks.push({
        id: "wheel-motor-catalogue",
        aspect: "catalogue-compatibility",
        status: "pass",
        message: `${wheelDef.name} is listed compatible with ${motorDef?.name ?? motor.name}.`,
        provenance: { method: "estimated", basis: "Catalogue motor-wheel pairing matrix" },
      });
    }
  } else {
    const assumption = "Wheel/motor lack catalogue pairing metadata; mechanical coupling compatibility is unverified.";
    assumptions.push(assumption);
    checks.push({
      id: "wheel-motor-catalogue",
      aspect: "catalogue-compatibility",
      status: "unknown",
      message: `Catalogue pairing for ${wheel.name} on ${motor.name} is unknown.`,
      assumption,
      provenance: { method: "unknown", notes: "Custom part without catalogue compatibility list" },
    });
  }

  // 2. Explicit shaft & hub engineering fit check (honestly reports unknown when absent!)
  const motorShaft =
    motor.engineeringSpec?.category === "motor"
      ? motor.engineeringSpec.shaft
      : undefined;
  const wheelHub =
    wheel.engineeringSpec?.category === "wheel"
      ? wheel.engineeringSpec.hub
      : undefined;

  if (motorShaft && wheelHub) {
    if (motorShaft.profile !== wheelHub.profile) {
      checks.push({
        id: "shaft-hub-profile",
        aspect: "shaft-hub-fit",
        status: "error",
        message: `Shaft profile "${motorShaft.profile}" does not match wheel hub "${wheelHub.profile}".`,
        provenance: motor.engineeringSpec?.generalProvenance,
        correctiveAction: "Use matching shaft adapter or hub profile.",
      });
    } else if (
      motorShaft.diameterM !== undefined &&
      wheelHub.boreDiameterM !== undefined &&
      Math.abs(motorShaft.diameterM - wheelHub.boreDiameterM) > 0.001
    ) {
      checks.push({
        id: "shaft-hub-diameter",
        aspect: "shaft-hub-fit",
        status: "error",
        message: `Shaft diameter ${(motorShaft.diameterM * 1000).toFixed(1)} mm does not match bore ${(wheelHub.boreDiameterM * 1000).toFixed(1)} mm.`,
        provenance: motor.engineeringSpec?.generalProvenance,
        correctiveAction: "Match motor shaft diameter to wheel hub bore diameter.",
      });
    } else {
      checks.push({
        id: "shaft-hub-fit-ok",
        aspect: "shaft-hub-fit",
        status: "pass",
        message: `Shaft (${motorShaft.profile}) matches wheel hub interface.`,
        provenance: motor.engineeringSpec?.generalProvenance,
      });
    }
  } else {
    const assumption =
      "Physical shaft bore and hub coupling dimensions are unverified in catalogue presets; coupling assumed via Workshop Motor-Wheel link.";
    assumptions.push(assumption);
    checks.push({
      id: "shaft-hub-unverified",
      aspect: "shaft-hub-fit",
      status: "unknown",
      message: `Shaft-to-hub mechanical fit (${motor.name} → ${wheel.name}) is unverified.`,
      assumption,
      provenance: {
        method: "unknown",
        notes: "ShaftInterface or HubInterface geometry not specified.",
      },
    });
  }

  // 3. Wheel-chassis side clearance check
  if (foundation) {
    const cyl = getPartCylinderDimensions(wheel);
    const wheelInnerZ = Math.abs(wheel.position[2]) - cyl.width * 0.5;
    const halfFoundationW = foundation.width * 0.5;
    const overlapsChassisZ =
      Math.abs(wheel.position[0]) < foundation.length * 0.5 + cyl.radius &&
      wheelInnerZ < halfFoundationW - 0.005;

    if (overlapsChassisZ) {
      const motorBox = getPartBoxExtents(motor);
      void motorBox;
      checks.push({
        id: "wheel-chassis-clearance",
        aspect: "surface-clearance",
        status: "warning",
        message: `${wheel.name} inner sidewall sits inside foundation width (${halfFoundationW.toFixed(2)} m), indicating chassis interference.`,
        provenance: { method: "estimated", basis: "Wheel inner sidewall vs chassis half-width comparison" },
        correctiveAction: "Move motor outward laterally or narrow foundation width for tyre clearance.",
      });
    } else if (wheelInnerZ - halfFoundationW < 0.015 && wheelInnerZ >= halfFoundationW - 0.005) {
      checks.push({
        id: "wheel-tight-clearance",
        aspect: "surface-clearance",
        status: "warning",
        message: `${wheel.name} has tight lateral clearance (${((wheelInnerZ - halfFoundationW) * 100).toFixed(1)} cm) next to chassis wall.`,
        provenance: { method: "estimated", basis: "Wheel sidewall gap < 1.5 cm" },
        correctiveAction: "Consider adding a spacer or reducing wheel width slightly.",
      });
    } else {
      checks.push({
        id: "wheel-chassis-clearance",
        aspect: "surface-clearance",
        status: "pass",
        message: `${wheel.name} clears chassis sidewalls laterally.`,
        provenance: { method: "estimated", basis: "Cylindrical sidewall clearance check" },
      });
    }
  }

  const status = summarizeStatusFromChecks(checks);
  return {
    status,
    summary:
      checks.find((c) => c.status === "error")?.message ??
      checks.find((c) => c.status === "warning")?.message ??
      checks.find((c) => c.status === "unknown")?.message ??
      `${wheel.name} coupled to ${motor.name}.`,
    provenanceState: summarizeProvenance(checks),
    checks,
    assumptions: Array.from(new Set(assumptions)),
  };
}

/**
 * Predicts compatibility impact on direct children if `originalPart` is replaced
 * with `candidateReplacement`, preventing silent relationship breakage.
 */
export function evaluateComponentReplacementImpact(params: {
  readonly originalPart: RobotPart;
  readonly candidateReplacement: RobotPart;
  readonly parts: readonly RobotPart[];
  readonly connections: readonly RobotConnection[];
  readonly foundation?: FoundationConfig | null;
}): ReplacementCompatibilityImpact {
  const { originalPart, candidateReplacement, parts, connections, foundation } =
    params;

  const childConnections = connections.filter(
    (c) => (c.parentId ?? c.sourceId) === originalPart.id
  );
  const affectedChildren: Array<{
    readonly childId: string;
    readonly childName: string;
    readonly evaluation: MechanicalCompatibilityEvaluation;
  }> = [];

  const replacementInterfaces = resolvePartMountingInterfaces(
    candidateReplacement,
    foundation
  );

  for (const conn of childConnections) {
    const childId = conn.childId ?? conn.targetId;
    const childPart = parts.find((p) => p.id === childId);
    if (!childPart) continue;

    const childInterfaces = resolvePartMountingInterfaces(childPart, foundation);
    const matchedParentIface =
      replacementInterfaces.find((i) => i.id === conn.parentMountPointId) ??
      replacementInterfaces[0] ??
      null;
    const matchedChildIface =
      childInterfaces.find((i) => i.id === conn.childMountPointId) ??
      childInterfaces[0] ??
      null;

    const evaluation = evaluateComponentAttachmentCompatibility({
      childPart,
      parentPart: candidateReplacement,
      parentInterface: matchedParentIface,
      childInterface: matchedChildIface,
      foundation,
      existingConnections: connections,
    });

    affectedChildren.push({
      childId: childPart.id,
      childName: childPart.name,
      evaluation,
    });
  }

  const brokenCount = affectedChildren.filter(
    (c) => c.evaluation.status === "incompatible"
  ).length;
  const warningCount = affectedChildren.filter(
    (c) => c.evaluation.status === "compatible-with-warnings"
  ).length;
  const unknownCount = affectedChildren.filter(
    (c) => c.evaluation.status === "unknown"
  ).length;

  let overallStatus: AttachmentCompatibilityStatus = "compatible";
  if (brokenCount > 0) overallStatus = "incompatible";
  else if (unknownCount > 0) overallStatus = "unknown";
  else if (warningCount > 0) overallStatus = "compatible-with-warnings";

  return {
    overallStatus,
    affectedChildren,
    brokenCount,
    warningCount,
    unknownCount,
  };
}
