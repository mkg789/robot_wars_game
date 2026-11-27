import type { RobotPart } from "../../robot-builder/types/robot.types";
import type {
  ElectricalCompatibilityResult,
  ElectricalConnection,
  ElectricalDiagnostic,
  ElectricalValidationReport,
} from "../types/electrical.types";
import { resolvePartElectricalSpec } from "./electricalComponentAdapters";
import {
  evaluateElectricalCompatibility,
  resolveDirectedPowerEndpoints,
} from "./electricalCompatibility";
import { analyzePowerDistribution } from "./powerDistributionAnalysis";

/**
 * Validates electrical components and logical `ElectricalConnection` graphs across the robot assembly.
 * Returns structured diagnostics distinguishing errors, warnings, info, and unknown states.
 */
export function validateElectricalAssembly(params: {
  readonly parts: readonly RobotPart[];
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly trippedFuseIds?: readonly string[];
}): ElectricalValidationReport {
  const { parts, electricalConnections, trippedFuseIds } = params;
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
        interfaceId: !srcIface ? conn.sourceInterfaceId : conn.targetInterfaceId,
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
        interfaceId: srcIface.interfaceId,
        pinId: conn.sourcePinId,
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
        interfaceId: srcIface.interfaceId,
        pinId: conn.sourcePinId,
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
        interfaceId: dstIface.interfaceId,
        pinId: conn.targetPinId,
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
        interfaceId: srcIface.interfaceId,
        pinId: conn.sourcePinId,
        relatedInterfaceId: dstIface.interfaceId,
        relatedPinId: conn.targetPinId,
        connectionId: conn.id,
        conditionEvaluated: "Detected duplicate source/target interface+pin signature.",
        correctiveAction: "Remove redundant parallel wire record.",
        provenance: conn.provenance,
      });
    } else {
      seenSignatures.add(sig);
    }

    // Track multiple active outputs driving the same input terminal/pin (order-insensitive)
    const directedPowerForDriver = resolveDirectedPowerEndpoints({
      connection: conn,
      sourceComponent: srcSpec,
      sourceInterface: srcIface,
      targetComponent: dstSpec,
      targetInterface: dstIface,
    });
    const isDirectedSignalForward =
      srcIface.role === "signal-output" &&
      (dstIface.role === "signal-input" || dstIface.role === "signal-bidirectional");
    const isDirectedSignalReverse =
      dstIface.role === "signal-output" &&
      (srcIface.role === "signal-input" || srcIface.role === "signal-bidirectional");

    const driverPair =
      directedPowerForDriver &&
      (directedPowerForDriver.wasReversed ? dstIface.role === "power-output" : srcIface.role === "power-output")
        ? {
            driverPart: directedPowerForDriver.wasReversed ? dstPart : srcPart,
            driverIface: directedPowerForDriver.wasReversed ? dstIface : srcIface,
            driverPinId: directedPowerForDriver.sourcePinId,
            receiverPart: directedPowerForDriver.wasReversed ? srcPart : dstPart,
            receiverIface: directedPowerForDriver.wasReversed ? srcIface : dstIface,
            receiverPinId: directedPowerForDriver.targetPinId,
          }
        : isDirectedSignalForward
          ? {
              driverPart: srcPart,
              driverIface: srcIface,
              driverPinId: conn.sourcePinId,
              receiverPart: dstPart,
              receiverIface: dstIface,
              receiverPinId: conn.targetPinId,
            }
          : isDirectedSignalReverse
            ? {
                driverPart: dstPart,
                driverIface: dstIface,
                driverPinId: conn.targetPinId,
                receiverPart: srcPart,
                receiverIface: srcIface,
                receiverPinId: conn.sourcePinId,
              }
            : null;

    if (driverPair) {
      const targetKey = `${driverPair.receiverPart.id}:${driverPair.receiverIface.interfaceId}:${driverPair.receiverPinId ?? "*"}`;
      const prevCount = targetDriversCount.get(targetKey) ?? 0;
      targetDriversCount.set(targetKey, prevCount + 1);
      if (prevCount >= 1 && driverPair.receiverIface.role !== "ground") {
        diagnostics.push({
          id: `elec-multidrive-${conn.id}`,
          severity: "error",
          code: "multi-driver-conflict",
          title: "Multiple active drivers on single input",
          reason: `${driverPair.receiverPart.name} (${driverPair.receiverIface.name}) receives power or signals from multiple outputs simultaneously.`,
          partId: driverPair.receiverPart.id,
          relatedPartId: driverPair.driverPart.id,
          interfaceId: driverPair.receiverIface.interfaceId,
          pinId: driverPair.receiverPinId,
          relatedInterfaceId: driverPair.driverIface.interfaceId,
          relatedPinId: driverPair.driverPinId,
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
      // Scope edge fault to the downstream load/branch rather than poisoning upstream Battery/PDB rails
      let faultPart = srcPart;
      let relatedPart = dstPart;
      let faultIface = srcIface;
      let faultPin = srcPin;
      let relatedIface = dstIface;
      let relatedPin = dstPin;

      if (directedPowerForDriver) {
        const useDst = !directedPowerForDriver.wasReversed;
        faultPart = useDst ? dstPart : srcPart;
        relatedPart = useDst ? srcPart : dstPart;
        faultIface = useDst ? dstIface : srcIface;
        faultPin = useDst ? dstPin : srcPin;
        relatedIface = useDst ? srcIface : dstIface;
        relatedPin = useDst ? srcPin : dstPin;
      } else if (srcIface.role.startsWith("power") && dstIface.role.startsWith("signal")) {
        faultPart = dstPart;
        relatedPart = srcPart;
        faultIface = dstIface;
        faultPin = dstPin;
        relatedIface = srcIface;
        relatedPin = srcPin;
      } else if (
        (srcSpec.componentType === "battery" || srcSpec.componentType === "pdb") &&
        dstSpec.componentType !== "battery" &&
        dstSpec.componentType !== "pdb"
      ) {
        faultPart = dstPart;
        relatedPart = srcPart;
        faultIface = dstIface;
        faultPin = dstPin;
        relatedIface = srcIface;
        relatedPin = srcPin;
      }

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
        partId: faultPart.id,
        relatedPartId: relatedPart.id,
        interfaceId: faultIface.interfaceId,
        pinId: faultPin?.pinId,
        relatedInterfaceId: relatedIface.interfaceId,
        relatedPinId: relatedPin?.pinId,
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
        interfaceId: srcIface.interfaceId,
        pinId: srcPin?.pinId,
        relatedInterfaceId: dstIface.interfaceId,
        relatedPinId: dstPin?.pinId,
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
        interfaceId: srcIface.interfaceId,
        pinId: srcPin?.pinId,
        relatedInterfaceId: dstIface.interfaceId,
        relatedPinId: dstPin?.pinId,
        connectionId: conn.id,
        conditionEvaluated: `evaluateElectricalCompatibility(${compat.conditionsEvaluated.join(", ")})`,
        correctiveAction: compat.correctiveAction ?? "Supply missing voltage/current specifications to verify.",
        provenance: compat.provenance,
      });
    }
  }

  // Track aggregate rail load draw & single-purpose pin over-subscription
  const railLoadDrawMap = new Map<
    string,
    { partName: string; ifaceName: string; partId: string; ifaceId: string; maxContA: number; totalLoadA: number; lastConnId: string; provenance: ElectricalDiagnostic["provenance"] }
  >();
  const pinUsageMap = new Map<
    string,
    { partId: string; partName: string; ifaceId: string; pinId: string; pinName: string; connIds: string[]; provenance: ElectricalDiagnostic["provenance"] }
  >();

  for (const conn of electricalConnections) {
    const srcPart = partsById.get(conn.sourcePartId);
    const dstPart = partsById.get(conn.targetPartId);
    const srcSpec = srcPart ? specsByPartId.get(srcPart.id) : null;
    const dstSpec = dstPart ? specsByPartId.get(dstPart.id) : null;
    if (!srcPart || !dstPart || !srcSpec || !dstSpec) continue;

    const srcIface = srcSpec.interfaces.find((i) => i.interfaceId === conn.sourceInterfaceId);
    const dstIface = dstSpec.interfaces.find((i) => i.interfaceId === conn.targetInterfaceId);
    if (!srcIface || !dstIface) continue;

    // Aggregate summed continuous draw per active power rail output (normalized direction)
    const directedPower = resolveDirectedPowerEndpoints({
      connection: conn,
      sourceComponent: srcSpec,
      sourceInterface: srcIface,
      targetComponent: dstSpec,
      targetInterface: dstIface,
    });
    const supplyPart = directedPower?.wasReversed ? dstPart : srcPart;
    const supplyIface = directedPower?.wasReversed ? dstIface : srcIface;
    const loadIface = directedPower?.wasReversed ? srcIface : dstIface;
    if (
      directedPower &&
      supplyIface.role === "power-output" &&
      supplyIface.currentSpec?.maxContinuousA !== undefined
    ) {
      const dstDraw = loadIface.currentSpec;
      const drawA = dstDraw?.nominalA ?? dstDraw?.maxContinuousA;
      if (drawA !== undefined) {
        const railKey = `${supplyPart.id}:${supplyIface.interfaceId}`;
        const existing = railLoadDrawMap.get(railKey);
        if (existing) {
          existing.totalLoadA += drawA;
          existing.lastConnId = conn.id;
        } else {
          railLoadDrawMap.set(railKey, {
            partName: supplyPart.name,
            ifaceName: supplyIface.name,
            partId: supplyPart.id,
            ifaceId: supplyIface.interfaceId,
            maxContA: supplyIface.currentSpec.maxContinuousA,
            totalLoadA: drawA,
            lastConnId: conn.id,
            provenance: supplyIface.provenance,
          });
        }
      }
    }

    // Track pin allocation conflicts on dedicated non-bus pins (exclude GND, passive/PDB, I2C/SPI/CAN shared buses)
    const trackEndpointPin = (
      part: typeof srcPart,
      spec: typeof srcSpec,
      iface: typeof srcIface,
      pinId: string | undefined
    ) => {
      if (!pinId) return;
      if (iface.role === "ground" || spec.componentType === "pdb" || spec.componentType === "passive" || spec.componentType === "battery") {
        return;
      }
      const pin = spec.pins.find((p) => p.pinId === pinId);
      if (!pin || pin.isGround) return;
      const isSharedBus = pin.signalTypes.some((s) => s === "i2c" || s === "spi" || s === "can");
      if (isSharedBus || pin.role === "power-output") return;

      const key = `${part.id}:${pin.pinId}`;
      const existing = pinUsageMap.get(key);
      if (existing) {
        existing.connIds.push(conn.id);
      } else {
        pinUsageMap.set(key, {
          partId: part.id,
          partName: part.name,
          ifaceId: iface.interfaceId,
          pinId: pin.pinId,
          pinName: pin.pinName,
          connIds: [conn.id],
          provenance: pin.provenance,
        });
      }
    };

    trackEndpointPin(srcPart, srcSpec, srcIface, conn.sourcePinId);
    trackEndpointPin(dstPart, dstSpec, dstIface, conn.targetPinId);
  }

  const externalErrorFaults = diagnostics
    .filter((d) => d.severity === "error" && d.partId && d.code !== "missing-component")
    .map((d) => ({ partId: d.partId!, title: d.title }));

  const powerResult = analyzePowerDistribution({
    parts,
    electricalConnections,
    trippedFuseIds,
    externalErrorFaults,
  });

  // Merge power-path diagnostics while avoiding duplicate rail-load alerts
  const hasPowerRailAlertFor = new Set(
    powerResult.diagnostics
      .filter(
        (d) =>
          d.code === "rail-current-exceeded" || d.code === "regulator-overload"
      )
      .map((d) => `${d.partId ?? ""}:${d.interfaceId ?? ""}`)
  );

  for (const rail of railLoadDrawMap.values()) {
    if (
      rail.totalLoadA > rail.maxContA &&
      !hasPowerRailAlertFor.has(`${rail.partId}:${rail.ifaceId}`)
    ) {
      diagnostics.push({
        id: `elec-rail-overload-${rail.partId}-${rail.ifaceId}`,
        severity: "warning",
        code: "rail-current-exceeded",
        title: `Aggregate rail load exceeds ${rail.partName} limit`,
        reason: `Combined loads connected to ${rail.partName} (${rail.ifaceName}) total ${rail.totalLoadA.toFixed(2)}A, exceeding ${rail.maxContA.toFixed(2)}A continuous limit.`,
        partId: rail.partId,
        interfaceId: rail.ifaceId,
        connectionId: rail.lastConnId,
        conditionEvaluated: "Summed continuous load draw across shared power-output interface.",
        correctiveAction: "Offload actuators/motors to a battery PDB or higher-current buck converter.",
        provenance: rail.provenance,
      });
    }
  }

  for (const pDiag of powerResult.diagnostics) {
    if (!diagnostics.some((d) => d.id === pDiag.id)) {
      diagnostics.push(pDiag);
    }
  }

  for (const usage of pinUsageMap.values()) {
    if (usage.connIds.length > 1) {
      diagnostics.push({
        id: `elec-pin-conflict-${usage.partId}-${usage.pinId}`,
        severity: "warning",
        code: "pin-conflict",
        title: `Multiple connections on single-purpose pin ${usage.pinName}`,
        reason: `${usage.partName} pin "${usage.pinName}" is assigned to ${usage.connIds.length} connections simultaneously.`,
        partId: usage.partId,
        interfaceId: usage.ifaceId,
        pinId: usage.pinId,
        connectionId: usage.connIds[0],
        conditionEvaluated: "Checked exclusive GPIO/input pin usage outside shared buses.",
        correctiveAction: "Reassign one connection to another compatible free pin.",
        provenance: usage.provenance,
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
        const spec = specsByPartId.get(partId);
        const gndIface = spec?.interfaces.find((i) => i.role === "ground");
        // Switches and series inline fuses don't always carry a ground reference terminal
        if (spec && !gndIface) continue;
        diagnostics.push({
          id: `elec-nognd-${partId}`,
          severity: "warning",
          code: "missing-ground-reference",
          title: `No common ground reference on ${part?.name ?? partId}`,
          reason: `${part?.name ?? partId} participates in power wiring without an explicit ground return connection.`,
          partId,
          interfaceId: gndIface?.interfaceId,
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

  // Incomplete wiring check: detect installed active power consumers lacking incoming power when electrical wiring or power sources exist
  const hasPowerSource = Array.from(specsByPartId.values()).some(
    (s) => s?.componentType === "battery" || s?.componentType === "pdb" || s?.componentType === "voltage-regulator"
  );
  if (hasPowerSource || electricalConnections.length > 0) {
    for (const part of parts) {
      const spec = specsByPartId.get(part.id);
      if (!spec) continue;
      if (spec.componentType === "battery" || spec.componentType === "passive") continue;

      const powerInputs = spec.interfaces.filter((i) => i.role === "power-input");
      if (powerInputs.length === 0) continue;

      const hasIncomingPower = electricalConnections.some(
        (c) =>
          (c.targetPartId === part.id &&
            powerInputs.some((pi) => pi.interfaceId === c.targetInterfaceId)) ||
          (c.sourcePartId === part.id &&
            powerInputs.some((pi) => pi.interfaceId === c.sourceInterfaceId))
      );

      if (!hasIncomingPower) {
        diagnostics.push({
          id: `elec-nopower-${part.id}`,
          severity: "warning",
          code: "missing-power-connection",
          title: `Unpowered electrical component: ${part.name}`,
          reason: `${part.name} exposes a power input (${powerInputs[0].name}) with no incoming power connection.`,
          partId: part.id,
          interfaceId: powerInputs[0].interfaceId,
          pinId: powerInputs[0].pinIds[0],
          conditionEvaluated: "Checked incoming power connection to active electrical consumers.",
          correctiveAction: "Connect a voltage-compatible battery, PDB, regulator, or motor driver output.",
          provenance: spec.provenance,
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
    powerAnalysis: powerResult.analysis,
  };
}
