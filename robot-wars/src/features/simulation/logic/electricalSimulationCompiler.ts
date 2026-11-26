import { validateElectricalAssembly } from "../../electrical/logic/electricalValidation";
import { resolvePartElectricalSpec } from "../../electrical/logic/electricalComponentAdapters";
import type {
  ElectricalComponentSpec,
  ElectricalConnection,
} from "../../electrical/types/electrical.types";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import type {
  CompiledAuxiliaryLoad,
  CompiledElectricalFuse,
  CompiledElectricalRegulator,
  CompiledElectricalSwitch,
  CompiledMotorElectricalPath,
  ElectricalSimulationProfile,
  MotorSimulationConfig,
} from "../types/simulation.types";

function isSwitchSpec(spec: ElectricalComponentSpec): boolean {
  return (
    spec.componentType === "switch" ||
    spec.driverOrRegulatorSpec?.powerRole === "switch"
  );
}

function isFuseSpec(spec: ElectricalComponentSpec): boolean {
  return (
    spec.driverOrRegulatorSpec?.powerRole === "fuse" ||
    spec.interfaces.some((i) => i.interfaceId.includes("fuse"))
  );
}

function isRegulatorSpec(spec: ElectricalComponentSpec): boolean {
  const role = spec.driverOrRegulatorSpec?.powerRole;
  return (
    spec.componentType === "voltage-regulator" ||
    role === "buck" ||
    role === "boost" ||
    role === "linear"
  );
}

function isPassThroughSpec(spec: ElectricalComponentSpec): boolean {
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

interface IncomingPowerEdge {
  readonly conn: ElectricalConnection;
  readonly sourcePartId: string;
  readonly sourceInterfaceId: string;
  readonly targetInterfaceId: string;
}

/**
 * Compiles electrical topology, active protection/control devices (switches, fuses),
 * regulators/BECs, motor-driver branches, and known auxiliary loads once per simulation session.
 *
 * Returns `null` when the robot assembly has no logical `ElectricalConnection` wiring,
 * preserving legacy mechanical-only physics behavior.
 */
export function compileElectricalSimulationProfile(params: {
  readonly parts: readonly RobotPart[];
  readonly electricalConnections?: readonly ElectricalConnection[];
  readonly compiledMotors: readonly MotorSimulationConfig[];
}): ElectricalSimulationProfile | null {
  const { parts, electricalConnections = [], compiledMotors } = params;

  if (electricalConnections.length === 0) {
    return null;
  }

  const partsById = new Map(parts.map((p) => [p.id, p]));
  const specsByPartId = new Map<string, ElectricalComponentSpec>();
  for (const part of parts) {
    const spec = resolvePartElectricalSpec(part);
    if (spec) specsByPartId.set(part.id, spec);
  }

  // Topology trace uses closed switches and un-tripped fuses so switched-off or resettable branches
  // remain mapped for dynamic toggling/resetting during simulation.
  const energizedPartsForTopology = parts.map((p) =>
    p.electricalState
      ? {
          ...p,
          electricalState: {
            switchClosed: true,
            fuseTripped: false,
          },
        }
      : p
  );

  const topologyReport = validateElectricalAssembly({
    parts: energizedPartsForTopology,
    electricalConnections,
  });

  // Build normalized power adjacency maps (upstream source -> target)
  const incomingByTargetPart = new Map<string, IncomingPowerEdge[]>();
  const outgoingBySourcePart = new Map<string, IncomingPowerEdge[]>();

  for (const conn of electricalConnections) {
    const srcSpec = specsByPartId.get(conn.sourcePartId);
    const dstSpec = specsByPartId.get(conn.targetPartId);
    if (!srcSpec || !dstSpec) continue;
    const srcIface = srcSpec.interfaces.find(
      (i) => i.interfaceId === conn.sourceInterfaceId
    );
    const dstIface = dstSpec.interfaces.find(
      (i) => i.interfaceId === conn.targetInterfaceId
    );
    if (!srcIface || !dstIface) continue;

    const isPowerEdge =
      conn.connectionType === "power" ||
      (srcIface.role.startsWith("power") && dstIface.role.startsWith("power"));
    if (!isPowerEdge) continue;

    const srcIsOut =
      srcIface.role === "power-output" || srcIface.role === "power-bidirectional";
    const dstIsIn =
      dstIface.role === "power-input" || dstIface.role === "power-bidirectional";
    if (!srcIsOut || !dstIsIn) continue;

    const edge: IncomingPowerEdge = {
      conn,
      sourcePartId: conn.sourcePartId,
      sourceInterfaceId: conn.sourceInterfaceId,
      targetInterfaceId: conn.targetInterfaceId,
    };

    const inList = incomingByTargetPart.get(conn.targetPartId) ?? [];
    inList.push(edge);
    incomingByTargetPart.set(conn.targetPartId, inList);

    const outList = outgoingBySourcePart.get(conn.sourcePartId) ?? [];
    outList.push(edge);
    outgoingBySourcePart.set(conn.sourcePartId, outList);
  }

  const consumerStates = topologyReport.powerAnalysis?.consumerStates ?? {};

  // Helper: walks backward from a target part to all reachable upstream power nodes/batteries
  const traceUpstreamChain = (
    targetPartId: string
  ): {
    readonly reachesBattery: boolean;
    readonly seriesSwitchIds: string[];
    readonly seriesFuseIds: string[];
    readonly nearestDriver?: {
      readonly partId: string;
      readonly continuousCurrentA?: number;
      readonly peakCurrentA?: number;
    };
    readonly nearestRegulator?: {
      readonly partId: string;
      readonly powerRole: "buck" | "boost" | "linear" | "bec";
      readonly outputNominalV: number;
    };
  } => {
    let reachesBattery = false;
    const switchSet = new Set<string>();
    const fuseSet = new Set<string>();
    let nearestDriver:
      | {
          partId: string;
          continuousCurrentA?: number;
          peakCurrentA?: number;
        }
      | undefined;
    let nearestRegulator:
      | {
          partId: string;
          powerRole: "buck" | "boost" | "linear" | "bec";
          outputNominalV: number;
        }
      | undefined;

    const queue: { partId: string; viaInterfaceId?: string }[] = [
      { partId: targetPartId },
    ];
    const visited = new Set<string>([targetPartId]);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const edges = incomingByTargetPart.get(cur.partId) ?? [];

      for (const edge of edges) {
        const upId = edge.sourcePartId;
        const upSpec = specsByPartId.get(upId);
        if (!upSpec) continue;

        if (upSpec.componentType === "battery") {
          reachesBattery = true;
        }
        if (isSwitchSpec(upSpec)) {
          switchSet.add(upId);
        }
        if (isFuseSpec(upSpec)) {
          fuseSet.add(upId);
        }

        const srcIface = upSpec.interfaces.find(
          (i) => i.interfaceId === edge.sourceInterfaceId
        );

        if (upSpec.componentType === "motor-driver") {
          if (edge.sourceInterfaceId.includes("bec")) {
            const becV =
              srcIface?.voltageSpec?.nominalV ??
              srcIface?.voltageSpec?.minV ??
              5.0;
            if (!nearestRegulator) {
              nearestRegulator = {
                partId: upId,
                powerRole: "bec",
                outputNominalV: becV,
              };
            }
          } else if (!nearestDriver) {
            const drv = upSpec.driverOrRegulatorSpec;
            nearestDriver = {
              partId: upId,
              continuousCurrentA:
                drv?.continuousCurrentPerChannelA ??
                srcIface?.currentSpec?.maxContinuousA,
              peakCurrentA:
                drv?.peakCurrentA ?? srcIface?.currentSpec?.peakOrStallA,
            };
          }
        } else if (isRegulatorSpec(upSpec) && !nearestRegulator) {
          const drv = upSpec.driverOrRegulatorSpec;
          const rawRole = drv?.powerRole;
          const powerRole: "buck" | "boost" | "linear" =
            rawRole === "boost"
              ? "boost"
              : rawRole === "linear"
                ? "linear"
                : "buck";
          const outNom =
            srcIface?.voltageSpec?.nominalV ??
            drv?.outputVoltageRangeV?.minV ??
            drv?.outputVoltageRangeV?.maxV;
          if (outNom !== undefined && outNom > 0) {
            nearestRegulator = {
              partId: upId,
              powerRole,
              outputNominalV: outNom,
            };
          }
        }

        if (!visited.has(upId)) {
          visited.add(upId);
          queue.push({ partId: upId, viaInterfaceId: edge.sourceInterfaceId });
        }
      }
    }

    return {
      reachesBattery,
      seriesSwitchIds: Array.from(switchSet),
      seriesFuseIds: Array.from(fuseSet),
      nearestDriver,
      nearestRegulator,
    };
  };

  // Helper: collect all downstream consumer part IDs from a given node
  const collectDownstreamParts = (startPartId: string): string[] => {
    const visited = new Set<string>();
    const queue = [startPartId];
    const result: string[] = [];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const edge of outgoingBySourcePart.get(cur) ?? []) {
        const nextId = edge.conn.targetPartId;
        if (!visited.has(nextId)) {
          visited.add(nextId);
          result.push(nextId);
          queue.push(nextId);
        }
      }
    }

    return result;
  };

  const topologyErrorPartIds = new Set(
    topologyReport.diagnostics
      .filter((d) => d.severity === "error" && d.partId)
      .map((d) => d.partId!)
  );

  // 1. Compile Motor Electrical Paths (supports partial/branch isolation!)
  const motorPaths: CompiledMotorElectricalPath[] = [];
  const unmappedWarnings: string[] = [];

  for (const motor of compiledMotors) {
    const cState = consumerStates[motor.motorId];
    const upstream = traceUpstreamChain(motor.motorId);
    const hasElectricalPath = Boolean(
      upstream.reachesBattery || (cState && cState.upstreamRailIds.length > 0)
    );
    const hasCompileFault = Boolean(
      cState?.hasPathFault || topologyErrorPartIds.has(motor.motorId)
    );
    const canEnergize = Boolean(
      hasElectricalPath && cState?.energized && !hasCompileFault
    );

    let supplyKind: CompiledMotorElectricalPath["supplyKind"] = "unpowered";
    if (canEnergize) {
      supplyKind = upstream.nearestRegulator
        ? "regulated-rail"
        : "unregulated-battery";
    }

    let faultReason: string | undefined;
    if (!hasElectricalPath) {
      faultReason = `Drive motor "${motor.name}" has no power connection path from battery.`;
    } else if (hasCompileFault) {
      faultReason =
        cState?.pathFaultReason ??
        `Drive motor "${motor.name}" has an active electrical fault.`;
    } else if (!cState?.energized) {
      faultReason = `Drive motor "${motor.name}" branch has no active upstream supply.`;
    }

    if (faultReason) {
      unmappedWarnings.push(faultReason);
    }

    motorPaths.push({
      motorId: motor.motorId,
      hasElectricalPath,
      canEnergize,
      hasCompileFault,
      faultReason,
      supplyKind,
      regulatedVoltageV: upstream.nearestRegulator?.outputNominalV,
      regulatorPartId: upstream.nearestRegulator?.partId,
      driverPartId: upstream.nearestDriver?.partId,
      driverContinuousCurrentA: upstream.nearestDriver?.continuousCurrentA,
      driverPeakCurrentA: upstream.nearestDriver?.peakCurrentA,
      seriesSwitchIds: upstream.seriesSwitchIds,
      seriesFuseIds: upstream.seriesFuseIds,
      hasGroundReturn: !cState?.hasMissingGround,
    });
  }

  // 2. Compile Regulators / BECs
  const regulators: CompiledElectricalRegulator[] = [];
  for (const [partId, spec] of specsByPartId.entries()) {
    const part = partsById.get(partId);
    if (!part) continue;

    if (isRegulatorSpec(spec)) {
      const drv = spec.driverOrRegulatorSpec;
      const outIface = spec.interfaces.find((i) => i.role === "power-output");
      const outNom =
        outIface?.voltageSpec?.nominalV ??
        drv?.outputVoltageRangeV?.minV ??
        drv?.outputVoltageRangeV?.maxV;
      if (outNom === undefined || outNom <= 0) continue;

      const rawRole = drv?.powerRole;
      const powerRole: "buck" | "boost" | "linear" =
        rawRole === "boost"
          ? "boost"
          : rawRole === "linear"
            ? "linear"
            : "buck";
      const upstream = traceUpstreamChain(partId);
      const regConsumer = consumerStates[partId];

      regulators.push({
        partId,
        name: part.name,
        powerRole,
        outputNominalV: outNom,
        inputMinV: drv?.inputVoltageRangeV?.minV,
        inputMaxV: drv?.inputVoltageRangeV?.maxV,
        dropoutVoltageV: drv?.dropoutVoltageV,
        efficiency: drv?.efficiency,
        maxOutputCurrentA:
          drv?.continuousCurrentPerChannelA ??
          outIface?.currentSpec?.maxContinuousA,
        quiescentCurrentA: drv?.quiescentCurrentA ?? 0,
        seriesSwitchIds: upstream.seriesSwitchIds,
        seriesFuseIds: upstream.seriesFuseIds,
        hasCompileFault: Boolean(
          regConsumer?.hasPathFault || topologyErrorPartIds.has(partId)
        ),
      });
    } else if (spec.componentType === "motor-driver") {
      const becIface = spec.interfaces.find(
        (i) => i.role === "power-output" && i.interfaceId.includes("bec")
      );
      if (becIface) {
        const becOutEdges = (outgoingBySourcePart.get(partId) ?? []).filter(
          (e) => e.sourceInterfaceId === becIface.interfaceId
        );
        const becNom = becIface.voltageSpec?.nominalV ?? 5.0;
        if (becOutEdges.length > 0 && becNom > 0) {
          const upstream = traceUpstreamChain(partId);
          regulators.push({
            partId,
            name: `${part.name} BEC`,
            powerRole: "bec",
            outputNominalV: becNom,
            inputMinV: spec.driverOrRegulatorSpec?.inputVoltageRangeV?.minV,
            inputMaxV: spec.driverOrRegulatorSpec?.inputVoltageRangeV?.maxV,
            dropoutVoltageV: 0.5,
            maxOutputCurrentA: becIface.currentSpec?.maxContinuousA,
            quiescentCurrentA: spec.driverOrRegulatorSpec?.quiescentCurrentA ?? 0,
            seriesSwitchIds: upstream.seriesSwitchIds,
            seriesFuseIds: upstream.seriesFuseIds,
            hasCompileFault: Boolean(topologyErrorPartIds.has(partId)),
          });
        }
      }
    }
  }

  // 3. Compile Auxiliary Loads (controllers, sensors, servos, auxiliary motors)
  const driveMotorIdSet = new Set(compiledMotors.map((m) => m.motorId));
  const auxiliaryLoads: CompiledAuxiliaryLoad[] = [];
  let auxiliaryLoadA = 0;
  let hasUnknownAuxiliaryLoad = false;

  for (const [partId, spec] of specsByPartId.entries()) {
    if (driveMotorIdSet.has(partId)) continue;
    if (spec.componentType === "battery") continue;
    if (isPassThroughSpec(spec) || isRegulatorSpec(spec)) continue;
    if (spec.componentType === "motor-driver") {
      const quiesc = spec.driverOrRegulatorSpec?.quiescentCurrentA;
      if (quiesc !== undefined && quiesc > 0) {
        const cState = consumerStates[partId];
        if (cState?.energized && !cState.hasPathFault) {
          const up = traceUpstreamChain(partId);
          auxiliaryLoadA += quiesc;
          auxiliaryLoads.push({
            partId,
            name: `${partsById.get(partId)?.name ?? partId} (quiescent)`,
            nominalCurrentA: quiesc,
            supplyKind: "unregulated-battery",
            seriesSwitchIds: up.seriesSwitchIds,
            seriesFuseIds: up.seriesFuseIds,
          });
        }
      }
      continue;
    }

    const cState = consumerStates[partId];
    if (!cState || !cState.upstreamRailIds.length) continue;
    if (!cState.energized || cState.hasPathFault) continue;

    const inIface = spec.interfaces.find((i) => i.role === "power-input");
    const knownA =
      inIface?.currentSpec?.nominalA ??
      inIface?.currentSpec?.maxContinuousA ??
      spec.controllerSpec?.idleCurrentA ??
      spec.motorSpec?.ratedCurrentA;

    if (knownA !== undefined && knownA > 0 && Number.isFinite(knownA)) {
      const up = traceUpstreamChain(partId);
      auxiliaryLoadA += knownA;
      auxiliaryLoads.push({
        partId,
        name: partsById.get(partId)?.name ?? partId,
        nominalCurrentA: knownA,
        supplyKind: up.nearestRegulator ? "regulated-rail" : "unregulated-battery",
        regulatedVoltageV: up.nearestRegulator?.outputNominalV,
        regulatorPartId: up.nearestRegulator?.partId,
        seriesSwitchIds: up.seriesSwitchIds,
        seriesFuseIds: up.seriesFuseIds,
      });
    } else if (cState.upstreamRailIds.length > 0) {
      hasUnknownAuxiliaryLoad = true;
    }
  }

  // 4. Compile Switches
  const switches: CompiledElectricalSwitch[] = [];
  for (const [partId, spec] of specsByPartId.entries()) {
    const part = partsById.get(partId);
    if (!part || !isSwitchSpec(spec)) continue;

    const downstreamParts = collectDownstreamParts(partId);
    const downstreamMotorIds = compiledMotors
      .map((m) => m.motorId)
      .filter(
        (mId) =>
          downstreamParts.includes(mId) ||
          motorPaths.some(
            (mp) => mp.motorId === mId && mp.seriesSwitchIds.includes(partId)
          )
      );

    switches.push({
      partId,
      name: part.name,
      defaultClosed: part.electricalState?.switchClosed !== false,
      affectsBatteryMain:
        compiledMotors.length > 0 &&
        downstreamMotorIds.length === compiledMotors.length,
      downstreamMotorIds,
      downstreamPartIds: downstreamParts,
    });
  }

  // 5. Compile Fuses
  const fuses: CompiledElectricalFuse[] = [];
  for (const [partId, spec] of specsByPartId.entries()) {
    const part = partsById.get(partId);
    if (!part || !isFuseSpec(spec)) continue;

    const inIface = spec.interfaces.find((i) => i.role === "power-input");
    const outIface = spec.interfaces.find((i) => i.role === "power-output");
    const ratedCurrentA =
      spec.driverOrRegulatorSpec?.continuousCurrentPerChannelA ??
      outIface?.currentSpec?.maxContinuousA ??
      inIface?.currentSpec?.maxContinuousA;

    if (
      ratedCurrentA === undefined ||
      ratedCurrentA <= 0 ||
      !Number.isFinite(ratedCurrentA)
    ) {
      unmappedWarnings.push(
        `Fuse "${part.name}" lacks an explicit continuous current rating and cannot auto-trip.`
      );
      continue;
    }

    const downstreamParts = collectDownstreamParts(partId);
    const downstreamMotorIds = compiledMotors
      .map((m) => m.motorId)
      .filter(
        (mId) =>
          downstreamParts.includes(mId) ||
          motorPaths.some(
            (mp) => mp.motorId === mId && mp.seriesFuseIds.includes(partId)
          )
      );

    fuses.push({
      partId,
      name: part.name,
      ratedCurrentA,
      initialTripped: Boolean(part.electricalState?.fuseTripped),
      affectsBatteryMain:
        compiledMotors.length > 0 &&
        downstreamMotorIds.length === compiledMotors.length,
      downstreamMotorIds,
      downstreamPartIds: downstreamParts,
    });
  }

  return {
    mode: "electrical-connected",
    auxiliaryLoadA: Number(auxiliaryLoadA.toFixed(4)),
    hasUnknownAuxiliaryLoad,
    auxiliaryLoads,
    switches,
    fuses,
    regulators,
    motorPaths,
    unmappedWarnings: Array.from(new Set(unmappedWarnings)),
  };
}
