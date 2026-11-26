import type { RobotPart } from "../../robot-builder/types/robot.types";
import { resolvePartElectricalSpec } from "./electricalComponentAdapters";
import type {
  ElectricalComponentSpec,
  ElectricalConnection,
  ElectricalDiagnostic,
  ElectricalInterfaceSpec,
  ElectricalPowerPathAnalysis,
  ElectricalPowerRailConsumerState,
  ElectricalPowerRailSummary,
  ElectricalProvenance,
  ElectricalVoltageRange,
} from "../types/electrical.types";

interface VoltageEnvelope {
  readonly nominalV?: number;
  readonly minV: number;
  readonly maxV: number;
  readonly isRegulated: boolean;
  readonly provenance: ElectricalProvenance;
}

interface PowerOutputNode {
  readonly part: RobotPart;
  readonly spec: ElectricalComponentSpec;
  readonly iface: ElectricalInterfaceSpec;
}

function getInterfaceVoltageBounds(
  spec: ElectricalComponentSpec,
  iface: ElectricalInterfaceSpec
): ElectricalVoltageRange | undefined {
  if (iface.voltageSpec) return iface.voltageSpec;
  const firstPin = iface.pinIds[0]
    ? spec.pins.find((p) => p.pinId === iface.pinIds[0])
    : undefined;
  return firstPin?.supportedVoltage;
}

function isPassThroughComponent(spec: ElectricalComponentSpec): boolean {
  const role = spec.driverOrRegulatorSpec?.powerRole;
  return (
    spec.componentType === "pdb" ||
    spec.componentType === "switch" ||
    spec.componentType === "passive" ||
    role === "pdb" ||
    role === "switch" ||
    role === "fuse" ||
    role === "pass-through"
  );
}

function isRegulatorComponent(spec: ElectricalComponentSpec): boolean {
  const role = spec.driverOrRegulatorSpec?.powerRole;
  return (
    spec.componentType === "voltage-regulator" ||
    role === "buck" ||
    role === "boost" ||
    role === "linear"
  );
}

function getPowerRoleLabel(spec: ElectricalComponentSpec): string {
  const role = spec.driverOrRegulatorSpec?.powerRole;
  if (role === "buck") return "Buck Regulator";
  if (role === "boost") return "Boost Regulator";
  if (role === "linear") return "Linear Regulator";
  if (role === "pdb" || spec.componentType === "pdb") return "PDB";
  if (role === "switch" || spec.componentType === "switch") return "Power Switch";
  if (role === "fuse") return "Inline Fuse";
  if (spec.componentType === "battery") return "Battery Bus";
  if (spec.componentType === "controller") return "Controller Logic Rail";
  if (spec.componentType === "motor-driver") return "Driver/BEC Output";
  return "Power Branch";
}

function combineEnvelopes(envelopes: readonly VoltageEnvelope[]): VoltageEnvelope | null {
  if (envelopes.length === 0) return null;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  let sumNom = 0;
  let nomCount = 0;
  let isRegulated = true;
  let hasUnknown = false;

  for (const env of envelopes) {
    minV = Math.min(minV, env.minV);
    maxV = Math.max(maxV, env.maxV);
    if (env.nominalV !== undefined) {
      sumNom += env.nominalV;
      nomCount += 1;
    }
    if (!env.isRegulated) isRegulated = false;
    if (env.provenance.method === "unknown") hasUnknown = true;
  }

  return {
    minV,
    maxV,
    nominalV: nomCount > 0 ? Number((sumNom / nomCount).toFixed(2)) : undefined,
    isRegulated,
    provenance: hasUnknown
      ? { method: "unknown", notes: "Combined upstream rails include unknown specs." }
      : envelopes[0].provenance,
  };
}

/**
 * Resolves functional power-path propagation, regulator input/output constraints,
 * pass-through voltage forwarding (PDB/switch/fuse), downstream load aggregation,
 * and common ground connectivity across connected RobotPart assemblies.
 * Missing ratings remain explicit unknown flags rather than fabricated guesses.
 */
export function analyzePowerDistribution(params: {
  readonly parts: readonly RobotPart[];
  readonly electricalConnections: readonly ElectricalConnection[];
}): {
  readonly analysis: ElectricalPowerPathAnalysis;
  readonly diagnostics: readonly ElectricalDiagnostic[];
} {
  const { parts, electricalConnections } = params;
  const diagnostics: ElectricalDiagnostic[] = [];
  const emittedDiagIds = new Set<string>();
  const pushDiag = (diag: ElectricalDiagnostic) => {
    if (emittedDiagIds.has(diag.id)) return;
    emittedDiagIds.add(diag.id);
    diagnostics.push(diag);
  };

  const partsById = new Map(parts.map((p) => [p.id, p]));
  const specsByPartId = new Map<string, ElectricalComponentSpec>();
  for (const p of parts) {
    const spec = resolvePartElectricalSpec(p);
    if (spec) specsByPartId.set(p.id, spec);
  }

  const powerConns = electricalConnections.filter((c) => {
    if (c.connectionType === "power") return true;
    const srcIface = specsByPartId
      .get(c.sourcePartId)
      ?.interfaces.find((i) => i.interfaceId === c.sourceInterfaceId);
    const dstIface = specsByPartId
      .get(c.targetPartId)
      ?.interfaces.find((i) => i.interfaceId === c.targetInterfaceId);
    return Boolean(
      srcIface?.role.startsWith("power") && dstIface?.role.startsWith("power")
    );
  });

  // Build ground connectivity components (undirected over ground connections)
  const groundAdj = new Map<string, Set<string>>();
  for (const c of electricalConnections) {
    const srcIface = specsByPartId
      .get(c.sourcePartId)
      ?.interfaces.find((i) => i.interfaceId === c.sourceInterfaceId);
    const dstIface = specsByPartId
      .get(c.targetPartId)
      ?.interfaces.find((i) => i.interfaceId === c.targetInterfaceId);
    if (
      c.connectionType === "ground" ||
      srcIface?.role === "ground" ||
      dstIface?.role === "ground"
    ) {
      (groundAdj.get(c.sourcePartId) ?? (() => {
        const s = new Set<string>();
        groundAdj.set(c.sourcePartId, s);
        return s;
      })()).add(c.targetPartId);
      (groundAdj.get(c.targetPartId) ?? (() => {
        const s = new Set<string>();
        groundAdj.set(c.targetPartId, s);
        return s;
      })()).add(c.sourcePartId);
    }
  }

  const getGroundGroup = (startPartId: string): Set<string> => {
    const visited = new Set<string>([startPartId]);
    const queue = [startPartId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nxt of groundAdj.get(cur) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return visited;
  };

  // Directed power adjacency: upstream output part -> incoming power connections to targets
  const incomingPowerByTargetPart = new Map<string, ElectricalConnection[]>();
  const outgoingPowerBySourceKey = new Map<string, ElectricalConnection[]>();
  for (const c of powerConns) {
    const srcSpec = specsByPartId.get(c.sourcePartId);
    const dstSpec = specsByPartId.get(c.targetPartId);
    if (!srcSpec || !dstSpec) continue;
    const srcIface = srcSpec.interfaces.find((i) => i.interfaceId === c.sourceInterfaceId);
    const dstIface = dstSpec.interfaces.find((i) => i.interfaceId === c.targetInterfaceId);
    if (!srcIface || !dstIface) continue;

    // Normalize flow direction output -> input if user wired target->source
    const srcIsOut = srcIface.role === "power-output" || srcIface.role === "power-bidirectional";
    const dstIsIn = dstIface.role === "power-input" || dstIface.role === "power-bidirectional";
    if (!srcIsOut || !dstIsIn) continue;

    (incomingPowerByTargetPart.get(c.targetPartId) ?? (() => {
      const arr: ElectricalConnection[] = [];
      incomingPowerByTargetPart.set(c.targetPartId, arr);
      return arr;
    })()).push(c);

    const srcKey = `${c.sourcePartId}:${c.sourceInterfaceId}`;
    (outgoingPowerBySourceKey.get(srcKey) ?? (() => {
      const arr: ElectricalConnection[] = [];
      outgoingPowerBySourceKey.set(srcKey, arr);
      return arr;
    })()).push(c);
  }

  // Forward iterative propagation across power graph (handles arbitrary series PDB -> Switch -> Fuse -> Buck -> Load)
  const outputEnvelopeByKey = new Map<string, VoltageEnvelope>();
  const inputEnvelopeByPartId = new Map<string, VoltageEnvelope>();
  const upstreamSourceIdsByPartId = new Map<string, Set<string>>();

  // Seed independent batteries
  for (const [partId, spec] of specsByPartId.entries()) {
    if (spec.componentType !== "battery") continue;
    for (const iface of spec.interfaces) {
      if (iface.role !== "power-output" && iface.role !== "power-bidirectional") continue;
      const vSpec = getInterfaceVoltageBounds(spec, iface);
      const minV = vSpec?.minV ?? vSpec?.nominalV;
      const maxV = vSpec?.maxV ?? vSpec?.nominalV;
      if (minV !== undefined && maxV !== undefined) {
        outputEnvelopeByKey.set(`${partId}:${iface.interfaceId}`, {
          minV,
          maxV,
          nominalV: vSpec?.nominalV,
          isRegulated: false,
          provenance: iface.provenance,
        });
      }
      upstreamSourceIdsByPartId.set(partId, new Set([partId]));
    }
  }

  // Topological relaxation (up to parts.length + 2 passes to avoid infinite cycles)
  const maxPasses = Math.max(2, parts.length + 2);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    for (const [partId, spec] of specsByPartId.entries()) {
      if (spec.componentType === "battery") continue;

      const incoming = incomingPowerByTargetPart.get(partId) ?? [];
      const incomingEnvelopes: VoltageEnvelope[] = [];
      const sourceSet = new Set<string>();

      for (const conn of incoming) {
        const upstreamKey = `${conn.sourcePartId}:${conn.sourceInterfaceId}`;
        const upEnv = outputEnvelopeByKey.get(upstreamKey);
        if (upEnv) {
          incomingEnvelopes.push(upEnv);
          const prevSources = upstreamSourceIdsByPartId.get(conn.sourcePartId);
          if (prevSources) {
            for (const s of prevSources) sourceSet.add(s);
          } else {
            sourceSet.add(conn.sourcePartId);
          }
        }
      }

      if (sourceSet.size > 0) {
        const existingSet = upstreamSourceIdsByPartId.get(partId);
        if (!existingSet || existingSet.size !== sourceSet.size) {
          upstreamSourceIdsByPartId.set(partId, sourceSet);
          changed = true;
        }
      }

      const combinedIn = combineEnvelopes(incomingEnvelopes);
      if (combinedIn) {
        const prevIn = inputEnvelopeByPartId.get(partId);
        if (
          !prevIn ||
          prevIn.minV !== combinedIn.minV ||
          prevIn.maxV !== combinedIn.maxV ||
          prevIn.nominalV !== combinedIn.nominalV
        ) {
          inputEnvelopeByPartId.set(partId, combinedIn);
          changed = true;
        }
      }

      // Compute outgoing voltage envelopes produced by this node
      for (const outIface of spec.interfaces) {
        if (outIface.role !== "power-output" && outIface.role !== "power-bidirectional") {
          continue;
        }
        const outKey = `${partId}:${outIface.interfaceId}`;

        if (isPassThroughComponent(spec)) {
          // Pass-through components forward upstream voltage only when fed!
          if (combinedIn) {
            const prevOut = outputEnvelopeByKey.get(outKey);
            if (
              !prevOut ||
              prevOut.minV !== combinedIn.minV ||
              prevOut.maxV !== combinedIn.maxV
            ) {
              outputEnvelopeByKey.set(outKey, combinedIn);
              changed = true;
            }
          }
        } else {
          // Regulator, BEC, or Controller regulated logic rail
          // Note: only produces downstream rail if incoming power is fed (or if standalone source without power-input interface)
          const requiresInput = spec.interfaces.some((i) => i.role === "power-input");
          if (requiresInput && !combinedIn) continue;

          const outV = getInterfaceVoltageBounds(spec, outIface);
          const minV = outV?.minV ?? outV?.nominalV;
          const maxV = outV?.maxV ?? outV?.nominalV;
          if (minV !== undefined && maxV !== undefined) {
            const regEnv: VoltageEnvelope = {
              minV,
              maxV,
              nominalV: outV?.nominalV,
              isRegulated:
                isRegulatorComponent(spec) ||
                spec.componentType === "controller" ||
                outIface.interfaceId.includes("bec"),
              provenance: outIface.provenance,
            };
            const prevOut = outputEnvelopeByKey.get(outKey);
            if (!prevOut || prevOut.minV !== regEnv.minV || prevOut.maxV !== regEnv.maxV) {
              outputEnvelopeByKey.set(outKey, regEnv);
              changed = true;
            }
          }
        }
      }
    }

    if (!changed) break;
  }

  // Evaluate pass-through / regulator constraints + end-to-end propagated consumer voltage faults
  for (const [partId, spec] of specsByPartId.entries()) {
    const part = partsById.get(partId)!;
    const incoming = incomingPowerByTargetPart.get(partId) ?? [];
    const inEnv = inputEnvelopeByPartId.get(partId);

    // Check regulators & pass-throughs that have outgoing consumers but NO live upstream supply
    const hasOutConsumers = spec.interfaces.some(
      (i) =>
        (i.role === "power-output" || i.role === "power-bidirectional") &&
        (outgoingPowerBySourceKey.get(`${partId}:${i.interfaceId}`)?.length ?? 0) > 0
    );
    const requiresIn = spec.interfaces.some((i) => i.role === "power-input");
    if (spec.componentType !== "battery" && requiresIn && hasOutConsumers && !inEnv) {
      const inIface = spec.interfaces.find((i) => i.role === "power-input");
      pushDiag({
        id: `pwr-nosource-${partId}`,
        severity: "warning",
        code: "missing-upstream-source",
        title: `${part.name} power branch is unfed`,
        reason: `${part.name} supplies downstream loads without an active upstream power source (battery/bus) feeding its input.`,
        partId,
        interfaceId: inIface?.interfaceId,
        pinId: inIface?.pinIds[0],
        conditionEvaluated: "Traced energized upstream power path from battery/source to distribution node.",
        correctiveAction: `Wire a compatible battery or live power rail into ${part.name}'s input terminal.`,
        provenance: spec.provenance,
      });
    }

    // Regulator input / topology checks (Buck dropout, Boost polarity, Linear dropout)
    if (isRegulatorComponent(spec) && inEnv) {
      const drv = spec.driverOrRegulatorSpec;
      const role = drv?.powerRole;
      const inIface = spec.interfaces.find((i) => i.role === "power-input");
      const outNomV =
        spec.interfaces.find((i) => i.role === "power-output")?.voltageSpec?.nominalV ??
        drv?.outputVoltageRangeV?.minV;
      const dropout = drv?.dropoutVoltageV;

      if (role === "boost" && outNomV !== undefined && inEnv.maxV > outNomV + 0.1) {
        pushDiag({
          id: `pwr-boost-overvin-${partId}`,
          severity: "error",
          code: "buck-boost-polarity-fault",
          title: `Boost converter ${part.name} input exceeds target ${outNomV}V`,
          reason: `Upstream input reaches ${inEnv.maxV.toFixed(1)}V, above ${part.name}'s boosted output setpoint (${outNomV.toFixed(1)}V); a standard step-up converter cannot regulate downward.`,
          partId,
          interfaceId: inIface?.interfaceId,
          connectionId: incoming[0]?.id,
          conditionEvaluated: "Checked boost converter Vin_max vs Vout_nominal.",
          correctiveAction: "Select a buck/buck-boost converter or lower upstream supply voltage.",
          provenance: spec.provenance,
        });
      }

      if (
        (role === "buck" || role === "linear") &&
        outNomV !== undefined &&
        dropout !== undefined
      ) {
        const reqMinV = outNomV + dropout;
        if (inEnv.maxV < reqMinV - 0.05) {
          pushDiag({
            id: `pwr-dropout-err-${partId}`,
            severity: "error",
            code: "regulator-input-out-of-range",
            title: `${part.name} below minimum dropout voltage`,
            reason: `Upstream supply reaches only ${inEnv.maxV.toFixed(1)}V, below minimum ${reqMinV.toFixed(1)}V needed for ${outNomV.toFixed(1)}V regulation (${dropout.toFixed(1)}V dropout).`,
            partId,
            interfaceId: inIface?.interfaceId,
            connectionId: incoming[0]?.id,
            conditionEvaluated: "Evaluated Vout + dropoutVoltageV against upstream Vin_max.",
            correctiveAction: "Use a higher cell-count battery, boost converter, or LDO regulator.",
            provenance: spec.provenance,
          });
        } else if (inEnv.minV < reqMinV - 0.05) {
          pushDiag({
            id: `pwr-dropout-warn-${partId}`,
            severity: "warning",
            code: "regulator-input-out-of-range",
            title: `${part.name} approaches dropout under low battery`,
            reason: `Upstream minimum (${inEnv.minV.toFixed(1)}V) drops below ${reqMinV.toFixed(1)}V regulation threshold (${outNomV.toFixed(1)}V + ${dropout.toFixed(1)}V dropout). Output may sag when battery discharges.`,
            partId,
            interfaceId: inIface?.interfaceId,
            connectionId: incoming[0]?.id,
            conditionEvaluated: "Evaluated Vout + dropoutVoltageV against upstream Vin_min.",
            correctiveAction: "Keep battery voltage above cutoff or use buck-boost regulation.",
            provenance: spec.provenance,
          });
        }
      }
    }

    // Check propagated source-to-consumer overvoltage/undervoltage across pass-through chains!
    if (inEnv && !isPassThroughComponent(spec)) {
      const inIface = spec.interfaces.find((i) => i.role === "power-input");
      const targetRange = inIface ? getInterfaceVoltageBounds(spec, inIface) : undefined;
      const dstMin = targetRange?.minV ?? targetRange?.nominalV;
      const dstMax = targetRange?.maxV ?? targetRange?.nominalV;

      // Only flag pass-through propagated faults when direct upstream wire was a pass-through node
      // (direct battery -> load checks already emit `voltage-mismatch` in evaluateElectricalCompatibility)
      const cameViaPassThrough = incoming.some((c) => {
        const upSpec = specsByPartId.get(c.sourcePartId);
        return upSpec ? isPassThroughComponent(upSpec) : false;
      });

      if (cameViaPassThrough && dstMax !== undefined && dstMin !== undefined) {
        if (inEnv.maxV > dstMax + 0.05) {
          pushDiag({
            id: `pwr-pt-ov-${partId}`,
            severity: "error",
            code: "pass-through-overvoltage",
            title: `Propagated overvoltage reaches ${part.name}`,
            reason: `Energized upstream power path reaches ${inEnv.maxV.toFixed(1)}V through pass-through distribution, exceeding ${part.name} max rating (${dstMax.toFixed(1)}V).`,
            partId,
            interfaceId: inIface?.interfaceId,
            pinId: inIface?.pinIds[0],
            connectionId: incoming[0]?.id,
            conditionEvaluated: "Propagated true upstream source voltage through pass-through PDB/switch/fuse nodes.",
            correctiveAction: `Insert a buck converter or voltage regulator before ${part.name}.`,
            provenance: inEnv.provenance,
          });
        } else if (inEnv.maxV < dstMin - 0.05) {
          pushDiag({
            id: `pwr-pt-uv-${partId}`,
            severity: "error",
            code: "pass-through-overvoltage",
            title: `Propagated undervoltage on ${part.name}`,
            reason: `Energized upstream power path reaches only ${inEnv.maxV.toFixed(1)}V through pass-through distribution, below ${part.name} minimum (${dstMin.toFixed(1)}V).`,
            partId,
            interfaceId: inIface?.interfaceId,
            pinId: inIface?.pinIds[0],
            connectionId: incoming[0]?.id,
            conditionEvaluated: "Propagated upstream source voltage through pass-through nodes vs consumer minV.",
            correctiveAction: "Use a boost converter or higher-voltage supply rail.",
            provenance: inEnv.provenance,
          });
        }
      }
    }
  }

  // Backward recursive load aggregation without fabricating unknown loads!
  // Returns { knownA, hasUnknown } drawn from `partId:ifaceId` outgoing rail.
  const computeRailLoad = (
    sourcePartId: string,
    sourceInterfaceId: string,
    visitedEdges: Set<string>
  ): {
    knownLoadA: number;
    hasUnknownLoad: boolean;
    consumerPartIds: string[];
    groundVerified: boolean;
  } => {
    const outConns =
      outgoingPowerBySourceKey.get(`${sourcePartId}:${sourceInterfaceId}`) ?? [];
    const srcGroundSet = getGroundGroup(sourcePartId);

    let knownLoadA = 0;
    let hasUnknownLoad = false;
    const consumerPartIds: string[] = [];
    let groundVerified = outConns.length > 0;

    for (const conn of outConns) {
      if (visitedEdges.has(conn.id)) continue;
      visitedEdges.add(conn.id);

      const dstSpec = specsByPartId.get(conn.targetPartId);
      const dstIface = dstSpec?.interfaces.find(
        (i) => i.interfaceId === conn.targetInterfaceId
      );
      if (!dstSpec || !dstIface) continue;

      if (!consumerPartIds.includes(conn.targetPartId)) {
        consumerPartIds.push(conn.targetPartId);
      }

      // Ground continuity check if target carries a GND interface
      const dstHasGnd = dstSpec.interfaces.some((i) => i.role === "ground");
      if (dstHasGnd && !srcGroundSet.has(conn.targetPartId)) {
        groundVerified = false;
      }

      if (isPassThroughComponent(dstSpec)) {
        // Recurse through PDB/switch/fuse downstream outputs
        const outIfaces = dstSpec.interfaces.filter(
          (i) => i.role === "power-output" || i.role === "power-bidirectional"
        );
        if (outIfaces.length === 0) {
          hasUnknownLoad = true;
        } else {
          for (const outIf of outIfaces) {
            const sub = computeRailLoad(conn.targetPartId, outIf.interfaceId, visitedEdges);
            knownLoadA += sub.knownLoadA;
            if (sub.hasUnknownLoad) hasUnknownLoad = true;
            if (!sub.groundVerified) groundVerified = false;
          }
        }
      } else if (isRegulatorComponent(dstSpec)) {
        // Aggregate regulator outputs & transform to regulator input current ONLY when efficiency / rule exists cleanly
        const drv = dstSpec.driverOrRegulatorSpec;
        const outIfaces = dstSpec.interfaces.filter((i) => i.role === "power-output");
        let regOutA = 0;
        let regOutUnknown = false;
        let regOutNomV = drv?.outputVoltageRangeV?.minV;

        for (const outIf of outIfaces) {
          if (outIf.voltageSpec?.nominalV !== undefined) {
            regOutNomV = outIf.voltageSpec.nominalV;
          }
          const sub = computeRailLoad(conn.targetPartId, outIf.interfaceId, visitedEdges);
          regOutA += sub.knownLoadA;
          if (sub.hasUnknownLoad) regOutUnknown = true;
          if (!sub.groundVerified) groundVerified = false;
        }

        const inEnv = inputEnvelopeByPartId.get(conn.targetPartId);
        const vinNom = inEnv?.nominalV ?? (inEnv ? (inEnv.minV + inEnv.maxV) / 2 : undefined);
        const quiescent = drv?.quiescentCurrentA ?? 0;

        if (regOutUnknown) hasUnknownLoad = true;

        if (drv?.powerRole === "linear") {
          knownLoadA += regOutA + quiescent;
        } else if (
          drv?.efficiency !== undefined &&
          drv.efficiency > 0 &&
          vinNom !== undefined &&
          vinNom > 0 &&
          regOutNomV !== undefined
        ) {
          knownLoadA += (regOutNomV * regOutA) / (vinNom * drv.efficiency) + quiescent;
        } else {
          // Cannot reliably scale switching converter input current without Vin + efficiency
          knownLoadA += regOutA;
          hasUnknownLoad = true;
        }
      } else {
        // Direct leaf consumer (controller, sensor, motor, servo, motor-driver, actuator)
        const cSpec = dstIface.currentSpec;
        const loadA = cSpec?.nominalA ?? cSpec?.maxContinuousA;
        if (loadA !== undefined) {
          knownLoadA += loadA;
        } else {
          hasUnknownLoad = true;
        }
      }
    }

    return {
      knownLoadA: Number(knownLoadA.toFixed(3)),
      hasUnknownLoad,
      consumerPartIds,
      groundVerified,
    };
  };

  // Build explicit `ElectricalPowerRailSummary` for every active power-output rail
  const rails: ElectricalPowerRailSummary[] = [];
  for (const [key, conns] of outgoingPowerBySourceKey.entries()) {
    if (conns.length === 0) continue;
    const [sourcePartId, sourceInterfaceId] = key.split(":");
    const part = partsById.get(sourcePartId);
    const spec = specsByPartId.get(sourcePartId);
    const iface = spec?.interfaces.find((i) => i.interfaceId === sourceInterfaceId);
    if (!part || !spec || !iface) continue;

    const outputNode: PowerOutputNode = { part, spec, iface };
    const env = outputEnvelopeByKey.get(key);
    const agg = computeRailLoad(sourcePartId, sourceInterfaceId, new Set<string>());
    const maxContA =
      iface.currentSpec?.maxContinuousA ??
      spec.driverOrRegulatorSpec?.continuousCurrentPerChannelA;

    const railOverload = maxContA !== undefined && agg.knownLoadA > maxContA;
    if (railOverload) {
      const code = isRegulatorComponent(spec) ? "regulator-overload" : "rail-current-exceeded";
      pushDiag({
        id: `pwr-rail-load-${sourcePartId}-${sourceInterfaceId}`,
        severity: "warning",
        code,
        title: `${part.name} rail load (${agg.knownLoadA.toFixed(2)}A) exceeds ${maxContA.toFixed(2)}A limit`,
        reason: `Total downstream load on "${iface.name}" is ${agg.knownLoadA.toFixed(2)}A${agg.hasUnknownLoad ? " (plus unverified loads)" : ""}, exceeding continuous limit of ${maxContA.toFixed(2)}A.`,
        partId: sourcePartId,
        interfaceId: sourceInterfaceId,
        connectionId: conns[0].id,
        conditionEvaluated: "Aggregated known downstream power draw (including regulator efficiency scaling) vs rail maxContinuousA.",
        correctiveAction: "Split high-current consumers across another regulator channel, PDB, or higher-rated supply.",
        provenance: iface.provenance,
      });
    }

    const railKind: ElectricalPowerRailSummary["kind"] =
      spec.componentType === "battery"
        ? "source-bus"
        : isPassThroughComponent(spec)
          ? "pass-through-branch"
          : "regulated-rail";

    const hasRailErr = diagnostics.some(
      (d) =>
        d.severity === "error" &&
        (d.partId === sourcePartId || agg.consumerPartIds.includes(d.partId ?? ""))
    );
    const hasRailWarn = railOverload || !agg.groundVerified || !env;

    rails.push({
      railId: key,
      label: `${env?.nominalV !== undefined ? `${env.nominalV}V ` : ""}${getPowerRoleLabel(spec)} (${outputNode.part.name})`,
      kind: railKind,
      sourcePartId,
      sourceInterfaceId,
      voltageV: env
        ? { nominalV: env.nominalV, minV: env.minV, maxV: env.maxV }
        : iface.voltageSpec
          ? {
              nominalV: iface.voltageSpec.nominalV,
              minV: iface.voltageSpec.minV,
              maxV: iface.voltageSpec.maxV,
            }
          : undefined,
      maxContinuousCurrentA: maxContA,
      totalKnownLoadA: agg.knownLoadA,
      hasUnknownLoadCurrent: agg.hasUnknownLoad,
      consumerPartIds: agg.consumerPartIds,
      groundVerified: agg.groundVerified,
      status: hasRailErr
        ? "error"
        : hasRailWarn
          ? "warning"
          : env
            ? "healthy"
            : "unknown",
    });
  }

  // Build consumer energization & ground-state summary map
  const consumerStates: Record<string, ElectricalPowerRailConsumerState> = {};
  let ungroundedConsumerCount = 0;
  for (const [partId, spec] of specsByPartId.entries()) {
    const incoming = incomingPowerByTargetPart.get(partId) ?? [];
    const env = inputEnvelopeByPartId.get(partId);
    const hasPowerIn = spec.interfaces.some((i) => i.role === "power-input");
    if (!hasPowerIn && incoming.length === 0) continue;

    const srcGroup = getGroundGroup(partId);
    const sourcePartIds = incoming.map((c) => c.sourcePartId);
    const gndRequired = spec.interfaces.some((i) => i.role === "ground");
    const missingGnd =
      gndRequired &&
      sourcePartIds.some((sid) => {
        const upSpec = specsByPartId.get(sid);
        const upHasGnd = upSpec?.interfaces.some((i) => i.role === "ground");
        return upHasGnd && !srcGroup.has(sid);
      });

    if (missingGnd) ungroundedConsumerCount += 1;

    const hasPathFault = diagnostics.some(
      (d) =>
        d.severity === "error" &&
        (d.partId === partId || d.relatedPartId === partId)
    );

    consumerStates[partId] = {
      partId,
      energized: Boolean(env),
      upstreamRailIds: incoming.map(
        (c) => `${c.sourcePartId}:${c.sourceInterfaceId}`
      ),
      deliveredVoltageV: env
        ? { nominalV: env.nominalV, minV: env.minV, maxV: env.maxV }
        : undefined,
      hasMissingGround: missingGnd,
      hasPathFault,
    };
  }

  return {
    analysis: {
      rails,
      consumerStates,
      powerPathsCount: powerConns.length,
      ungroundedConsumerCount,
    },
    diagnostics,
  };
}
