import type { RobotPart } from "../../robot-builder/types/robot.types";
import type {
  ElectricalCompatibilityResult,
  ElectricalConnection,
  ElectricalDiagnostic,
  ElectricalValidationReport,
} from "../types/electrical.types";
import { resolvePartElectricalSpec } from "./electricalComponentAdapters";
import { evaluateElectricalCompatibility } from "./electricalCompatibility";

/**
 * Validates electrical components and logical `ElectricalConnection` graphs across the robot assembly.
 * Returns structured diagnostics distinguishing errors, warnings, info, and unknown states.
 */
export function validateElectricalAssembly(params: {
  readonly parts: readonly RobotPart[];
  readonly electricalConnections: readonly ElectricalConnection[];
}): ElectricalValidationReport {
  const { parts, electricalConnections } = params;
  const diagnostics: ElectricalDiagnostic[] = [];
  const connectionResults: Record<string, ElectricalCompatibilityResult> = {};

  const partsById = new Map(parts.map((p) => [p.id, p]));
  const specsByPartId = new Map(
    parts.map((p) => [p.id, resolvePartElectricalSpec(p)])
  );

  // 1. Check installed electrical components for incomplete specifications
  for (const part of parts) {
    const spec = specsByPartId.get(part.id);
    if (!spec) continue;

    if (spec.unknownFields.length > 0 && spec.provenance.method === "unknown") {
      diagnostics.push({
        id: `elec-missing-spec-${part.id}`,
        severity: "unknown",
        code: "missing-electrical-spec",
        title: `Missing electrical specs on ${part.name}`,
        reason: `${part.name} has unspecified fields: ${spec.unknownFields.join(", ")}.`,
        partId: part.id,
        conditionEvaluated: "Checked ElectricalComponentSpec unknownFields and provenance.",
        correctiveAction: "Assign verified datasheet or user-supplied electrical parameters.",
        provenance: spec.provenance,
      });
    }
  }

  // Track duplicate endpoints and active multi-driver output pins
  const seenSignatures = new Set<string>();
  const targetDriversCount = new Map<string, number>();

  for (const conn of electricalConnections) {
    const srcPart = partsById.get(conn.sourcePartId);
    const dstPart = partsById.get(conn.targetPartId);

    if (!srcPart || !dstPart) {
      diagnostics.push({
        id: `elec-missing-part-${conn.id}`,
        severity: "error",
        code: "missing-component",
        title: "Electrical connection references missing component",
        reason: `Connection "${conn.id}" references ${!srcPart ? conn.sourcePartId : conn.targetPartId}, which is not in the assembly.`,
        partId: !srcPart ? conn.targetPartId : conn.sourcePartId,
        connectionId: conn.id,
        conditionEvaluated: "Verified sourcePartId and targetPartId resolve in assembly parts.",
        correctiveAction: "Remove dangling electrical connection or restore deleted component.",
        provenance: conn.provenance,
      });
      continue;
    }

    const srcSpec = specsByPartId.get(srcPart.id);
    const dstSpec = specsByPartId.get(dstPart.id);
    if (!srcSpec || !dstSpec) {
      diagnostics.push({
        id: `elec-nospec-${conn.id}`,
        severity: "error",
        code: "missing-electrical-spec",
        title: "Wired component lacks electrical specification",
        reason: `${!srcSpec ? srcPart.name : dstPart.name} has no ElectricalComponentSpec assigned.`,
        partId: !srcSpec ? srcPart.id : dstPart.id,
        relatedPartId: !srcSpec ? dstPart.id : srcPart.id,
        connectionId: conn.id,
        conditionEvaluated: "Resolved ElectricalComponentSpec on wired components.",
        correctiveAction: "Assign an ElectricalComponentSpec before connecting interfaces.",
        provenance: conn.provenance,
      });
      continue;
    }

    const srcIface = srcSpec.interfaces.find(
      (i) => i.interfaceId === conn.sourceInterfaceId
    );
    const dstIface = dstSpec.interfaces.find(
      (i) => i.interfaceId === conn.targetInterfaceId
    );

    if (!srcIface || !dstIface) {
      diagnostics.push({
        id: `elec-bad-iface-${conn.id}`,
        severity: "error",
        code: "missing-interface",
        title: "Invalid electrical interface reference",
        reason: `Connection "${conn.id}" references missing interface "${!srcIface ? conn.sourceInterfaceId : conn.targetInterfaceId}" on ${!srcIface ? srcPart.name : dstPart.name}.`,
        partId: !srcIface ? srcPart.id : dstPart.id,
        connectionId: conn.id,
        conditionEvaluated: "Verified sourceInterfaceId and targetInterfaceId exist on component interfaces.",
        correctiveAction: "Reconnect using a valid component interface ID.",
        provenance: conn.provenance,
      });
      continue;
    }

    if (
      conn.sourcePartId === conn.targetPartId &&
      conn.sourceInterfaceId === conn.targetInterfaceId &&
      conn.sourcePinId === conn.targetPinId
    ) {
      diagnostics.push({
        id: `elec-self-${conn.id}`,
        severity: "error",
        code: "self-connection",
        title: "Self-loop electrical connection",
        reason: `Interface "${srcIface.name}" on ${srcPart.name} cannot connect to itself.`,
        partId: srcPart.id,
        connectionId: conn.id,
        conditionEvaluated: "Checked whether source and target endpoint IDs are identical.",
        correctiveAction: "Remove redundant self-connection.",
        provenance: conn.provenance,
      });
      continue;
    }

    const srcPin = conn.sourcePinId
      ? srcSpec.pins.find((p) => p.pinId === conn.sourcePinId)
      : srcIface.pinIds.length === 1
        ? srcSpec.pins.find((p) => p.pinId === srcIface.pinIds[0])
        : undefined;
    const dstPin = conn.targetPinId
      ? dstSpec.pins.find((p) => p.pinId === conn.targetPinId)
      : dstIface.pinIds.length === 1
        ? dstSpec.pins.find((p) => p.pinId === dstIface.pinIds[0])
        : undefined;

    if (conn.sourcePinId && !srcPin) {
      diagnostics.push({
        id: `elec-bad-srcpin-${conn.id}`,
        severity: "error",
        code: "missing-pin",
        title: "Missing source pin definition",
        reason: `Source pin "${conn.sourcePinId}" was not found on ${srcPart.name}.`,
        partId: srcPart.id,
        connectionId: conn.id,
        conditionEvaluated: "Looked up sourcePinId in component pins list.",
        correctiveAction: "Select a valid source pin.",
        provenance: conn.provenance,
      });
      continue;
    }
    if (conn.targetPinId && !dstPin) {
      diagnostics.push({
        id: `elec-bad-dstpin-${conn.id}`,
        severity: "error",
        code: "missing-pin",
        title: "Missing destination pin definition",
        reason: `Destination pin "${conn.targetPinId}" was not found on ${dstPart.name}.`,
        partId: dstPart.id,
        connectionId: conn.id,
        conditionEvaluated: "Looked up targetPinId in component pins list.",
        correctiveAction: "Select a valid destination pin.",
        provenance: conn.provenance,
      });
      continue;
    }

    // Duplicate connection check (order-insensitive on unordered pair)
    const epA = `${conn.sourcePartId}:${conn.sourceInterfaceId}:${conn.sourcePinId ?? "*"}`;
    const epB = `${conn.targetPartId}:${conn.targetInterfaceId}:${conn.targetPinId ?? "*"}`;
    const sig = epA < epB ? `${epA}--${epB}` : `${epB}--${epA}`;
    if (seenSignatures.has(sig)) {
      diagnostics.push({
        id: `elec-dup-${conn.id}`,
        severity: "warning",
        code: "duplicate-connection",
        title: "Duplicate electrical connection",
        reason: `Duplicate connection between ${srcPart.name} (${srcIface.name}) and ${dstPart.name} (${dstIface.name}).`,
        partId: srcPart.id,
        relatedPartId: dstPart.id,
        connectionId: conn.id,
        conditionEvaluated: "Detected duplicate source/target interface+pin signature.",
        correctiveAction: "Remove redundant parallel wire record.",
        provenance: conn.provenance,
      });
    } else {
      seenSignatures.add(sig);
    }

    // Track multiple active outputs driving the same input terminal/pin
    if (
      srcIface.role === "power-output" ||
      srcIface.role === "signal-output"
    ) {
      const targetKey = `${conn.targetPartId}:${conn.targetInterfaceId}:${conn.targetPinId ?? "*"}`;
      const prevCount = targetDriversCount.get(targetKey) ?? 0;
      targetDriversCount.set(targetKey, prevCount + 1);
      if (prevCount >= 1 && dstIface.role !== "ground") {
        diagnostics.push({
          id: `elec-multidrive-${conn.id}`,
          severity: "error",
          code: "multi-driver-conflict",
          title: "Multiple active drivers on single input",
          reason: `${dstPart.name} (${dstIface.name}) receives power or signals from multiple outputs simultaneously.`,
          partId: dstPart.id,
          relatedPartId: srcPart.id,
          connectionId: conn.id,
          conditionEvaluated: "Checked active output driver count per target terminal.",
          correctiveAction: "Use a dedicated bus, multiplexer, or isolate power rails.",
          provenance: conn.provenance,
        });
      }
    }

    const srcConnSpec = srcIface.connectorId
      ? srcSpec.connectors.find((c) => c.connectorId === srcIface.connectorId)
      : undefined;
    const dstConnSpec = dstIface.connectorId
      ? dstSpec.connectors.find((c) => c.connectorId === dstIface.connectorId)
      : undefined;

    const compat = evaluateElectricalCompatibility({
      sourceComponent: srcSpec,
      sourceInterface: srcIface,
      sourcePin: srcPin,
      sourceConnector: srcConnSpec,
      targetComponent: dstSpec,
      targetInterface: dstIface,
      targetPin: dstPin,
      targetConnector: dstConnSpec,
      signalProtocol: conn.signalProtocol,
    });
    connectionResults[conn.id] = compat;

    if (compat.status === "incompatible") {
      const hasVoltage = compat.checks.some(
        (c) => c.aspect === "voltage" && c.status === "error"
      );
      const hasDirection = compat.checks.some(
        (c) => c.aspect === "signal-direction" && c.status === "error"
      );
      const hasSignal = compat.checks.some(
        (c) => (c.aspect === "signal-protocol" || c.aspect === "pin-capability") && c.status === "error"
      );
      diagnostics.push({
        id: `elec-incompat-${conn.id}`,
        severity: "error",
        code: hasVoltage
          ? "voltage-mismatch"
          : hasDirection
            ? "invalid-signal-direction"
            : hasSignal
              ? "signal-protocol-mismatch"
              : "incompatible-interfaces",
        title: `Incompatible wiring (${srcPart.name} → ${dstPart.name})`,
        reason: compat.reason,
        partId: srcPart.id,
        relatedPartId: dstPart.id,
        connectionId: conn.id,
        conditionEvaluated: `evaluateElectricalCompatibility(${compat.conditionsEvaluated.join(", ")})`,
        correctiveAction: compat.correctiveAction,
        provenance: compat.provenance,
      });
    } else if (compat.status === "compatible-with-warnings") {
      const isCurrent = compat.checks.some(
        (c) => c.aspect === "current" && c.status === "warning"
      );
      const isConnector = compat.checks.some(
        (c) => c.aspect === "connector-physical" && c.status === "warning"
      );
      diagnostics.push({
        id: `elec-warn-${conn.id}`,
        severity: "warning",
        code: isCurrent
          ? "current-limit-exceeded"
          : isConnector
            ? "connector-mismatch"
            : "incompatible-interfaces",
        title: `Electrical warning (${srcPart.name} → ${dstPart.name})`,
        reason: compat.reason,
        partId: srcPart.id,
        relatedPartId: dstPart.id,
        connectionId: conn.id,
        conditionEvaluated: `evaluateElectricalCompatibility(${compat.conditionsEvaluated.join(", ")})`,
        correctiveAction: compat.correctiveAction,
        provenance: compat.provenance,
      });
    } else if (compat.status === "unknown") {
      diagnostics.push({
        id: `elec-unknown-${conn.id}`,
        severity: "unknown",
        code: "missing-electrical-spec",
        title: `Unverified electrical compatibility (${srcPart.name} → ${dstPart.name})`,
        reason: compat.reason,
        partId: srcPart.id,
        relatedPartId: dstPart.id,
        connectionId: conn.id,
        conditionEvaluated: `evaluateElectricalCompatibility(${compat.conditionsEvaluated.join(", ")})`,
        correctiveAction: compat.correctiveAction ?? "Supply missing voltage/current specifications to verify.",
        provenance: compat.provenance,
      });
    }
  }

  // Check if wired power connections exist without a ground return between the components
  if (electricalConnections.length > 0) {
    const groundLinkedParts = new Set<string>();
    for (const c of electricalConnections) {
      if (c.connectionType === "ground") {
        groundLinkedParts.add(c.sourcePartId);
        groundLinkedParts.add(c.targetPartId);
      }
    }
    const powerParts = new Set<string>();
    for (const c of electricalConnections) {
      if (c.connectionType === "power") {
        powerParts.add(c.sourcePartId);
        powerParts.add(c.targetPartId);
      }
    }
    for (const partId of powerParts) {
      if (!groundLinkedParts.has(partId)) {
        const part = partsById.get(partId);
        diagnostics.push({
          id: `elec-nognd-${partId}`,
          severity: "warning",
          code: "missing-ground-reference",
          title: `No common ground reference on ${part?.name ?? partId}`,
          reason: `${part?.name ?? partId} participates in power wiring without an explicit ground return connection.`,
          partId,
          conditionEvaluated: "Verified presence of ground connection on electrically powered components.",
          correctiveAction: "Connect ground interface (GND / BAT-) to complete the circuit reference.",
          provenance: {
            method: "estimated",
            basis: "Logical return-path topology check",
          },
        });
      }
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const unknownCount = diagnostics.filter((d) => d.severity === "unknown").length;

  let healthStatus: ElectricalValidationReport["healthStatus"] = "healthy";
  if (errorCount > 0) healthStatus = "error";
  else if (warningCount > 0) healthStatus = "warning";
  else if (unknownCount > 0) healthStatus = "unknown";

  return {
    isValid: errorCount === 0,
    healthStatus,
    diagnostics,
    errorCount,
    warningCount,
    unknownCount,
    connectionResults,
  };
}
