import { validateElectricalAssembly } from "../../electrical/logic/electricalValidation";
import { resolvePartElectricalSpec } from "../../electrical/logic/electricalComponentAdapters";
import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import type {
  SensorAvailabilityStatus,
  SensorDescriptor,
  SupportedSensorKind,
} from "../types/sensor.types";

/**
 * Classifies an installed RobotPart into a supported sensor kind, returning null for non-sensors.
 */
export function classifyPartSensorKind(
  part: RobotPart
): SupportedSensorKind | null {
  const catId = part.electricalCatalogueId?.toLowerCase() ?? "";
  if (catId.includes("hcsr04") || catId.includes("ultrasonic")) return "ultrasonic";
  if (catId.includes("vl53l0x") || catId.includes("tof")) return "tof-distance";
  if (catId.includes("ir-obstacle")) return "ir-proximity";
  if (catId.includes("line-follower")) return "line-sensor";
  if (catId.includes("mpu6050") || catId.includes("imu")) return "imu";
  if (catId.includes("adxl345") || catId.includes("accel")) return "accelerometer";
  if (catId.includes("l3gd20") || catId.includes("gyro")) return "gyroscope";
  if (catId.includes("encoder")) return "encoder";
  if (catId.includes("temp")) return "temperature";

  const spec = resolvePartElectricalSpec(part);
  if (!spec || spec.componentType !== "sensor") return null;

  const lookup = `${part.name} ${spec.model ?? ""}`.toLowerCase();
  if (lookup.includes("ultrasonic") || lookup.includes("sonar")) return "ultrasonic";
  if (lookup.includes("tof") || lookup.includes("laser")) return "tof-distance";
  if (lookup.includes("line")) return "line-sensor";
  if (lookup.includes("proximity") || lookup.includes("ir")) return "ir-proximity";
  if (lookup.includes("imu") || lookup.includes("mpu")) return "imu";
  if (lookup.includes("accel")) return "accelerometer";
  if (lookup.includes("gyro")) return "gyroscope";
  if (lookup.includes("encoder")) return "encoder";
  if (lookup.includes("temp")) return "temperature";

  return null;
}

/**
 * Discovers installed sensors from the robot's actual RobotPart assembly and resolves
 * each sensor's placement, mounting yaw, electrical readiness, and modeling assumptions.
 */
export function resolveRobotSensors(params: {
  readonly parts: readonly RobotPart[];
  readonly electricalConnections?: readonly ElectricalConnection[];
  readonly trippedFuseIds?: readonly string[];
  readonly isBatteryCutoff?: boolean;
}): readonly SensorDescriptor[] {
  const {
    parts,
    electricalConnections = [],
    trippedFuseIds,
    isBatteryCutoff = false,
  } = params;
  const hasAnyElectricalWiring = electricalConnections.length > 0;
  const validationReport = hasAnyElectricalWiring
    ? validateElectricalAssembly({
        parts,
        electricalConnections,
        trippedFuseIds,
      })
    : null;

  const descriptors: SensorDescriptor[] = [];

  for (const part of parts) {
    const sensorKind = classifyPartSensorKind(part);
    if (!sensorKind) continue;

    let availability: SensorAvailabilityStatus = "ready";
    let availabilityReason: string | undefined;
    const assumptions: string[] = [];

    if (!hasAnyElectricalWiring) {
      assumptions.push(
        "No electrical wiring configured on robot; sensor assumes testbed power availability."
      );
    } else if (validationReport) {
      const hardError = validationReport.diagnostics.find(
        (d) =>
          d.severity === "error" &&
          (d.partId === part.id || d.relatedPartId === part.id)
      );
      const consumerState = validationReport.powerAnalysis?.consumerStates[part.id];
      const signalConns = electricalConnections.filter(
        (c) =>
          (c.sourcePartId === part.id || c.targetPartId === part.id) &&
          c.connectionType !== "power" &&
          c.connectionType !== "ground"
      );
      const signalErrorConn = signalConns.find(
        (c) => validationReport.connectionResults[c.id]?.status === "incompatible"
      );
      const linkedPeerFault = signalConns
        .map((c) =>
          c.sourcePartId === part.id ? c.targetPartId : c.sourcePartId
        )
        .map((peerId) => ({
          peerId,
          part: parts.find((p) => p.id === peerId),
          peerPower: validationReport.powerAnalysis?.consumerStates[peerId],
        }))
        .find(
          ({ part: peerPart, peerPower }) =>
            peerPart?.type === "Controller" &&
            peerPower &&
            (!peerPower.energized || peerPower.hasPathFault)
        );

      if (hardError) {
        availability = "unavailable-electrical-fault";
        availabilityReason = hardError.title;
      } else if (consumerState?.hasPathFault) {
        availability = "unavailable-electrical-fault";
        availabilityReason =
          consumerState.pathFaultReason ??
          `${part.name} power supply path has an upstream electrical fault.`;
      } else if (signalErrorConn) {
        availability = "unavailable-electrical-fault";
        availabilityReason =
          validationReport.connectionResults[signalErrorConn.id].reason;
      } else if (!consumerState || !consumerState.energized) {
        availability = "unavailable-unpowered";
        availabilityReason = `${part.name} has no energized power supply path in electrical wiring.`;
      } else if (linkedPeerFault) {
        const peerName = linkedPeerFault.part?.name ?? linkedPeerFault.peerId;
        if (linkedPeerFault.peerPower?.hasPathFault) {
          availability = "unavailable-electrical-fault";
          availabilityReason = `${peerName} connected to ${part.name} has a power path fault.`;
        } else {
          availability = "unavailable-unpowered";
          availabilityReason = `${peerName} connected to ${part.name} signal line is unpowered.`;
        }
      } else {
        if (consumerState.hasMissingGround) {
          assumptions.push(
            "Electrical warning: sensor lacks an explicit common ground return wire."
          );
        }
        if (signalConns.length === 0) {
          assumptions.push(
            "Electrical notice: sensor signal interface is not explicitly wired to a controller pin; assuming testbed telemetry link."
          );
        }
      }
    }

    if (sensorKind === "temperature") {
      availability = "unavailable-unsupported";
      availabilityReason =
        "Thermal simulation model is not yet implemented; temperature reading unavailable.";
    } else if (isBatteryCutoff && availability === "ready") {
      availability = "unavailable-unpowered";
      availabilityReason = "Battery low-voltage cutoff active.";
    }

    descriptors.push({
      sensorId: part.id,
      name: part.name,
      sensorKind,
      catalogueId: part.electricalCatalogueId,
      localMountOffset: {
        x: part.position[0],
        y: part.position[1],
        z: part.position[2],
      },
      // Three.js +Y rotation rotates +X toward -Z; simulation heading rotates +X toward +Z
      mountYawOffsetRadians: -(part.rotation?.[1] ?? 0),
      spanWidthMeters: Math.max(0.02, part.size?.[2] ?? 0.08),
      availability,
      availabilityReason,
      assumptions,
    });
  }

  return descriptors;
}
