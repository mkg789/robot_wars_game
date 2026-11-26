import type { RobotPart } from "../../robot-builder/types/robot.types";
import { resolvePartElectricalSpec } from "./electricalComponentAdapters";
import type {
  ElectricalCompatibilityResult,
  ElectricalComponentSpec,
  ElectricalConnection,
  ElectricalDiagnostic,
  ElectricalInterfaceSpec,
  ElectricalPinSpec,
  ElectricalPowerPathAnalysis,
} from "../types/electrical.types";

export interface SchematicPortAnchor {
  readonly partId: string;
  readonly interfaceId: string;
  readonly pinId?: string;
  readonly label: string;
  readonly subLabel: string;
  readonly side: "left" | "right";
  readonly x: number;
  readonly y: number;
  readonly kind: "power" | "ground" | "signal";
  readonly isConnected: boolean;
  readonly connectedCount: number;
  readonly hasError: boolean;
  readonly hasWarning: boolean;
}

export interface SchematicNodeLayout {
  readonly part: RobotPart;
  readonly spec: ElectricalComponentSpec;
  readonly column: 0 | 1 | 2 | 3;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly ports: readonly SchematicPortAnchor[];
  readonly connectedPinCount: number;
  readonly totalPinCount: number;
  readonly healthStatus: "healthy" | "warning" | "error" | "unknown";
  readonly powerBadge?: string;
}

export interface SchematicWireLayout {
  readonly connection: ElectricalConnection;
  readonly pathD: string;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly labelX: number;
  readonly labelY: number;
  readonly strokeColor: string;
  readonly isDashed: boolean;
  readonly status: "valid" | "warning" | "error" | "unknown";
  readonly label: string;
}

export interface ElectricalSchematicGraph {
  readonly nodes: readonly SchematicNodeLayout[];
  readonly wires: readonly SchematicWireLayout[];
  readonly width: number;
  readonly height: number;
}

const NODE_WIDTH = 224;
const NODE_HEADER_HEIGHT = 44;
const PORT_ROW_HEIGHT = 24;
const NODE_BOTTOM_PAD = 12;
const COLUMN_X = [44, 340, 646, 962] as const;
const START_Y = 42;
const ROW_GAP_Y = 28;

function classifyColumn(spec: ElectricalComponentSpec): 0 | 1 | 2 | 3 {
  switch (spec.componentType) {
    case "battery":
      return 0;
    case "pdb":
    case "voltage-regulator":
    case "switch":
    case "passive":
      return 1;
    case "controller":
    case "motor-driver":
      return 2;
    default:
      return 3;
  }
}

function classifyPortKind(
  iface: ElectricalInterfaceSpec,
  pin?: ElectricalPinSpec
): "power" | "ground" | "signal" {
  if (iface.role === "ground" || pin?.isGround) return "ground";
  if (
    iface.role === "power-input" ||
    iface.role === "power-output" ||
    iface.role === "power-bidirectional" ||
    pin?.isPower
  ) {
    return "power";
  }
  return "signal";
}

function classifyPortSide(iface: ElectricalInterfaceSpec): "left" | "right" {
  if (iface.role === "power-output" || iface.role === "signal-output") {
    return "right";
  }
  if (iface.role === "signal-bidirectional" || iface.role === "power-bidirectional") {
    return "right";
  }
  return "left";
}

export function computeElectricalSchematicLayout(params: {
  readonly parts: readonly RobotPart[];
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly connectionResults: Readonly<Record<string, ElectricalCompatibilityResult>>;
  readonly diagnostics: readonly ElectricalDiagnostic[];
  readonly powerAnalysis?: ElectricalPowerPathAnalysis;
}): ElectricalSchematicGraph {
  const {
    parts,
    electricalConnections,
    connectionResults,
    diagnostics,
    powerAnalysis,
  } = params;

  const railByKey = new Map(
    (powerAnalysis?.rails ?? []).map((rail) => [rail.railId, rail])
  );

  const partSpecs: Array<{ part: RobotPart; spec: ElectricalComponentSpec }> = [];
  for (const part of parts) {
    const spec = resolvePartElectricalSpec(part);
    if (spec) partSpecs.push({ part, spec });
  }

  // Group by schematic flow column deterministically
  const columns: Array<Array<{ part: RobotPart; spec: ElectricalComponentSpec }>> = [
    [],
    [],
    [],
    [],
  ];
  for (const entry of partSpecs) {
    columns[classifyColumn(entry.spec)].push(entry);
  }

  const endpointConnectionCounts = new Map<string, number>();
  const wirePerSourceCounter = new Map<string, number>();
  for (const conn of electricalConnections) {
    const srcKey = `${conn.sourcePartId}:${conn.sourceInterfaceId}:${conn.sourcePinId ?? ""}`;
    const dstKey = `${conn.targetPartId}:${conn.targetInterfaceId}:${conn.targetPinId ?? ""}`;
    endpointConnectionCounts.set(srcKey, (endpointConnectionCounts.get(srcKey) ?? 0) + 1);
    endpointConnectionCounts.set(dstKey, (endpointConnectionCounts.get(dstKey) ?? 0) + 1);

    const ifaceSrcKey = `${conn.sourcePartId}:${conn.sourceInterfaceId}`;
    const ifaceDstKey = `${conn.targetPartId}:${conn.targetInterfaceId}`;
    endpointConnectionCounts.set(
      ifaceSrcKey,
      (endpointConnectionCounts.get(ifaceSrcKey) ?? 0) + 1
    );
    endpointConnectionCounts.set(
      ifaceDstKey,
      (endpointConnectionCounts.get(ifaceDstKey) ?? 0) + 1
    );
  }

  const nodes: SchematicNodeLayout[] = [];
  const portLookup = new Map<string, SchematicPortAnchor>();
  let maxBottomY = 460;

  columns.forEach((entries, colIdx) => {
    let cursorY = START_Y;
    const x = COLUMN_X[colIdx];

    for (const { part, spec } of entries) {
      const partDiags = diagnostics.filter(
        (d) => d.partId === part.id || d.relatedPartId === part.id
      );

      let healthStatus: SchematicNodeLayout["healthStatus"] = "healthy";
      if (partDiags.some((d) => d.severity === "error")) healthStatus = "error";
      else if (partDiags.some((d) => d.severity === "warning")) healthStatus = "warning";
      else if (partDiags.some((d) => d.severity === "unknown")) healthStatus = "unknown";

      // Build concise schematic port anchors (pins within interfaces; fallback to interface row)
      const leftPortsDraft: Array<Omit<SchematicPortAnchor, "x" | "y">> = [];
      const rightPortsDraft: Array<Omit<SchematicPortAnchor, "x" | "y">> = [];

      const seenPinKeys = new Set<string>();
      for (const iface of spec.interfaces) {
        const side = classifyPortSide(iface);
        const targetBucket = side === "left" ? leftPortsDraft : rightPortsDraft;

        if (iface.pinIds.length === 0) {
          const count =
            endpointConnectionCounts.get(`${part.id}:${iface.interfaceId}`) ?? 0;
          const hasErr = partDiags.some(
            (d) =>
              d.severity === "error" &&
              (d.interfaceId === iface.interfaceId || d.relatedInterfaceId === iface.interfaceId)
          );
          const hasWarn = partDiags.some(
            (d) =>
              d.severity === "warning" &&
              (d.interfaceId === iface.interfaceId || d.relatedInterfaceId === iface.interfaceId)
          );
          targetBucket.push({
            partId: part.id,
            interfaceId: iface.interfaceId,
            label: iface.name,
            subLabel: iface.role,
            side,
            kind: classifyPortKind(iface),
            isConnected: count > 0,
            connectedCount: count,
            hasError: hasErr,
            hasWarning: hasWarn,
          });
        } else {
          for (const pinId of iface.pinIds) {
            if (seenPinKeys.has(pinId)) continue;
            seenPinKeys.add(pinId);
            const pin = spec.pins.find((p) => p.pinId === pinId);
            const pinSpecificCount =
              endpointConnectionCounts.get(`${part.id}:${iface.interfaceId}:${pinId}`) ?? 0;
            const ifaceWildcardCount =
              iface.pinIds.length === 1
                ? (endpointConnectionCounts.get(`${part.id}:${iface.interfaceId}:`) ?? 0)
                : 0;
            const count = pinSpecificCount + ifaceWildcardCount;
            const hasErr = partDiags.some(
              (d) =>
                d.severity === "error" &&
                (d.pinId === pinId || d.relatedPinId === pinId)
            );
            const hasWarn = partDiags.some(
              (d) =>
                d.severity === "warning" &&
                (d.pinId === pinId ||
                  d.relatedPinId === pinId ||
                  d.interfaceId === iface.interfaceId)
            );
            targetBucket.push({
              partId: part.id,
              interfaceId: iface.interfaceId,
              pinId,
              label: pin?.pinName ?? pinId,
              subLabel: pin?.signalTypes.length
                ? pin.signalTypes.slice(0, 2).join("/")
                : iface.role === "ground"
                  ? "REF"
                  : iface.voltageSpec?.nominalV !== undefined
                    ? `${iface.voltageSpec.nominalV}V`
                    : "",
              side,
              kind: classifyPortKind(iface, pin),
              isConnected: count > 0,
              connectedCount: count,
              hasError: hasErr,
              hasWarning: hasWarn,
            });
          }
        }
      }

      const rowCount = Math.max(leftPortsDraft.length, rightPortsDraft.length, 1);
      const height = NODE_HEADER_HEIGHT + rowCount * PORT_ROW_HEIGHT + NODE_BOTTOM_PAD;

      const ports: SchematicPortAnchor[] = [];
      leftPortsDraft.forEach((p, idx) => {
        const anchor: SchematicPortAnchor = {
          ...p,
          x,
          y: cursorY + NODE_HEADER_HEIGHT + idx * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2,
        };
        ports.push(anchor);
        const ifaceKey = `${part.id}:${anchor.interfaceId}`;
        if (!portLookup.has(ifaceKey)) portLookup.set(ifaceKey, anchor);
        if (anchor.pinId) {
          portLookup.set(`${ifaceKey}:${anchor.pinId}`, anchor);
        }
      });

      rightPortsDraft.forEach((p, idx) => {
        const anchor: SchematicPortAnchor = {
          ...p,
          x: x + NODE_WIDTH,
          y: cursorY + NODE_HEADER_HEIGHT + idx * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2,
        };
        ports.push(anchor);
        const ifaceKey = `${part.id}:${anchor.interfaceId}`;
        if (!portLookup.has(ifaceKey)) portLookup.set(ifaceKey, anchor);
        if (anchor.pinId) {
          portLookup.set(`${ifaceKey}:${anchor.pinId}`, anchor);
        }
      });

      const connectedPinCount = ports.filter((p) => p.isConnected).length;
      const ownedRails = (powerAnalysis?.rails ?? []).filter(
        (r) => r.sourcePartId === part.id
      );
      const consumerState = powerAnalysis?.consumerStates[part.id];
      let powerBadge: string | undefined;
      if (ownedRails.length > 0) {
        const primary = ownedRails[0];
        const vStr =
          primary.voltageV?.nominalV !== undefined
            ? `${primary.voltageV.nominalV}V`
            : primary.voltageV?.maxV !== undefined
              ? `≤${primary.voltageV.maxV}V`
              : "BUS";
        const curStr =
          primary.maxContinuousCurrentA !== undefined
            ? `${primary.totalKnownLoadA.toFixed(2)}/${primary.maxContinuousCurrentA}A`
            : `${primary.totalKnownLoadA.toFixed(2)}A`;
        powerBadge = `${vStr} · ${curStr}`;
      } else if (consumerState) {
        powerBadge = consumerState.energized
          ? consumerState.deliveredVoltageV?.nominalV !== undefined
            ? `${consumerState.deliveredVoltageV.nominalV}V IN`
            : "FED"
          : "UNFED";
      }

      nodes.push({
        part,
        spec,
        column: colIdx as 0 | 1 | 2 | 3,
        x,
        y: cursorY,
        width: NODE_WIDTH,
        height,
        ports,
        connectedPinCount,
        totalPinCount: ports.length,
        healthStatus,
        powerBadge,
      });

      cursorY += height + ROW_GAP_Y;
      maxBottomY = Math.max(maxBottomY, cursorY + 24);
    }
  });

  // Route curved orthogonal/bezier wire paths between ports with parallel lane spread
  const wires: SchematicWireLayout[] = [];
  for (const conn of electricalConnections) {
    const srcExactKey = conn.sourcePinId
      ? `${conn.sourcePartId}:${conn.sourceInterfaceId}:${conn.sourcePinId}`
      : `${conn.sourcePartId}:${conn.sourceInterfaceId}`;
    const dstExactKey = conn.targetPinId
      ? `${conn.targetPartId}:${conn.targetInterfaceId}:${conn.targetPinId}`
      : `${conn.targetPartId}:${conn.targetInterfaceId}`;

    const srcPort =
      portLookup.get(srcExactKey) ??
      portLookup.get(`${conn.sourcePartId}:${conn.sourceInterfaceId}`);
    const dstPort =
      portLookup.get(dstExactKey) ??
      portLookup.get(`${conn.targetPartId}:${conn.targetInterfaceId}`);

    if (!srcPort || !dstPort) continue;

    const compat = connectionResults[conn.id];
    const hasDiagError = diagnostics.some(
      (d) => d.connectionId === conn.id && d.severity === "error"
    );
    const hasDiagWarn = diagnostics.some(
      (d) => d.connectionId === conn.id && d.severity === "warning"
    );

    const status: SchematicWireLayout["status"] =
      hasDiagError || compat?.status === "incompatible"
        ? "error"
        : hasDiagWarn || compat?.status === "compatible-with-warnings"
          ? "warning"
          : compat?.status === "unknown"
            ? "unknown"
            : "valid";

    let strokeColor = "#38bdf8";
    if (status === "error") strokeColor = "#ef4444";
    else if (status === "warning") strokeColor = "#eab308";
    else if (conn.connectionType === "power") strokeColor = "#f59e0b";
    else if (conn.connectionType === "ground") strokeColor = "#94a3b8";
    else if (conn.connectionType === "pwm" || conn.connectionType === "bus") {
      strokeColor = "#22c55e";
    }

    const pairKey = `${srcPort.partId}->${dstPort.partId}`;
    const slotIdx = wirePerSourceCounter.get(pairKey) ?? 0;
    wirePerSourceCounter.set(pairKey, slotIdx + 1);
    const fanoutOffset = ((slotIdx % 4) - 1.5) * 14;

    const dx = dstPort.x - srcPort.x;
    const srcDir = srcPort.side === "right" ? 1 : -1;
    const dstDir = dstPort.side === "right" ? 1 : -1;
    const curveTension = Math.max(58, Math.min(180, Math.abs(dx) * 0.45 + Math.abs(fanoutOffset)));

    const c1x = srcPort.x + srcDir * curveTension;
    const c1y = srcPort.y + fanoutOffset;
    const c2x = dstPort.x + dstDir * curveTension;
    const c2y = dstPort.y - fanoutOffset;

    const pathD = `M ${srcPort.x} ${srcPort.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${dstPort.x} ${dstPort.y}`;
    const labelX = (srcPort.x + 3 * c1x + 3 * c2x + dstPort.x) / 8;
    const labelY = (srcPort.y + 3 * c1y + 3 * c2y + dstPort.y) / 8;

    const labelParts = [conn.connectionType.toUpperCase()];
    if (conn.connectionType === "power") {
      const railInfo = railByKey.get(
        `${conn.sourcePartId}:${conn.sourceInterfaceId}`
      );
      if (railInfo?.voltageV?.nominalV !== undefined) {
        labelParts.push(
          railInfo.kind === "regulated-rail"
            ? `${railInfo.voltageV.nominalV}V REG`
            : `${railInfo.voltageV.nominalV}V`
        );
      } else if (railInfo && !railInfo.voltageV) {
        labelParts.push("UNFED");
      }
    }
    if (conn.signalProtocol) labelParts.push(conn.signalProtocol.toUpperCase());
    if (conn.wireMetadata?.wireGaugeAwg) labelParts.push(`${conn.wireMetadata.wireGaugeAwg}AWG`);

    wires.push({
      connection: conn,
      pathD,
      startX: srcPort.x,
      startY: srcPort.y,
      endX: dstPort.x,
      endY: dstPort.y,
      labelX,
      labelY,
      strokeColor,
      isDashed: conn.connectionType === "ground" || status === "unknown",
      status,
      label: labelParts.join(" · "),
    });
  }

  return {
    nodes,
    wires,
    width: COLUMN_X[3] + NODE_WIDTH + 64,
    height: maxBottomY,
  };
}
