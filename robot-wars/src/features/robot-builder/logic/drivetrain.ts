import { generateMotorMountZones } from "./mountingZones";
import type {
  DrivetrainAssignment,
  DrivetrainConfiguration,
  DrivetrainSide,
  DrivetrainType,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";

export type PoweredWheelAssembly = DrivetrainAssignment & {
  motor: RobotPart;
  wheel: RobotPart;
  mountingZoneId: string;
  mountingLocation: string;
};

export type DrivetrainValidation = {
  isValid: boolean;
  errors: string[];
};

const sideLabels: Record<DrivetrainSide, string> = {
  left: "Left",
  right: "Right",
};

export function getDrivetrainSlotCount(type: DrivetrainType): 1 | 2 {
  return type === "differential-4" ? 2 : 1;
}

export function getDrivetrainAssignmentKey(
  assignment: DrivetrainAssignment
): string {
  return JSON.stringify([assignment.motorId, assignment.wheelId]);
}

function getConnectionPartIds(connection: RobotConnection) {
  return {
    parentId: connection.parentId ?? connection.sourceId,
    childId: connection.childId ?? connection.targetId,
  };
}

export type MotorMechanicalSupport = {
  supported: boolean;
  mountKind: "foundation-zone" | "structural" | "unmounted";
  mountingZoneId: string;
  mountingLocation: string;
  ancestorChain: string[];
};

export function resolveMotorMechanicalSupport(
  motor: RobotPart,
  parts: readonly RobotPart[],
  connections: readonly RobotConnection[],
  foundation: FoundationConfig
): MotorMechanicalSupport {
  const zones = new Map(
    generateMotorMountZones(foundation).map((zone) => [zone.id, zone])
  );
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const mechanicalByChildId = new Map<string, RobotConnection>();
  for (const connection of connections) {
    if (connection.type !== "Mechanical") continue;
    const { childId } = getConnectionPartIds(connection);
    if (!mechanicalByChildId.has(childId)) {
      mechanicalByChildId.set(childId, connection);
    }
  }

  const directConnection = mechanicalByChildId.get(motor.id);
  if (!directConnection) {
    return {
      supported: false,
      mountKind: "unmounted",
      mountingZoneId: motor.mountingZoneId ?? "",
      mountingLocation: "Unmounted",
      ancestorChain: [motor.id],
    };
  }

  const { parentId: directParentId } = getConnectionPartIds(directConnection);
  const zone = motor.mountingZoneId ? zones.get(motor.mountingZoneId) : undefined;

  if (directParentId === "foundation-chassis") {
    const parentIfaceId = directConnection.parentMountPointId;
    const isZoneAttachment =
      !parentIfaceId ||
      parentIfaceId === "foundation-zone" ||
      parentIfaceId === "foundation-chassis";
    if (isZoneAttachment) {
      if (!zone) {
        return {
          supported: false,
          mountKind: "unmounted",
          mountingZoneId: motor.mountingZoneId ?? "",
          mountingLocation: "Invalid Mount Zone",
          ancestorChain: [motor.id, "foundation-chassis"],
        };
      }
      return {
        supported: true,
        mountKind: "foundation-zone",
        mountingZoneId: zone.id,
        mountingLocation: zone.name,
        ancestorChain: [motor.id, "foundation-chassis"],
      };
    }

    const side: DrivetrainSide = motor.position[2] >= 0 ? "left" : "right";
    return {
      supported: true,
      mountKind: "structural",
      mountingZoneId: motor.mountingZoneId ?? `structural-${side}`,
      mountingLocation: `Chassis (${parentIfaceId})`,
      ancestorChain: [motor.id, "foundation-chassis"],
    };
  }

  const directParent = partsById.get(directParentId);
  const visited = new Set<string>([motor.id]);
  const ancestorChain: string[] = [motor.id];
  let currentId: string | undefined = directParentId;

  while (currentId) {
    if (visited.has(currentId)) {
      return {
        supported: false,
        mountKind: "unmounted",
        mountingZoneId: motor.mountingZoneId ?? "",
        mountingLocation: "Circular Mount",
        ancestorChain,
      };
    }
    visited.add(currentId);
    const currentPart = partsById.get(currentId);
    if (!currentPart || currentPart.type === "Wheel" || currentPart.type === "Motor") {
      return {
        supported: false,
        mountKind: "unmounted",
        mountingZoneId: motor.mountingZoneId ?? "",
        mountingLocation: "Unsupported Parent",
        ancestorChain,
      };
    }
    ancestorChain.push(currentId);

    if (currentId === "foundation-chassis") {
      const side: DrivetrainSide = motor.position[2] >= 0 ? "left" : "right";
      return {
        supported: true,
        mountKind: "structural",
        mountingZoneId: zone?.id ?? motor.mountingZoneId ?? `structural-${side}`,
        mountingLocation: `Structural (${directParent?.name ?? "Frame"})`,
        ancestorChain,
      };
    }

    const nextConn = mechanicalByChildId.get(currentId);
    currentId = nextConn ? getConnectionPartIds(nextConn).parentId : undefined;
  }

  return {
    supported: false,
    mountKind: "unmounted",
    mountingZoneId: motor.mountingZoneId ?? "",
    mountingLocation: directParent ? `Unanchored (${directParent.name})` : "Unmounted",
    ancestorChain,
  };
}

export function getPoweredWheelAssemblies(
  parts: readonly RobotPart[],
  connections: readonly RobotConnection[],
  foundation: FoundationConfig | null
): PoweredWheelAssembly[] {
  if (!foundation) return [];

  const partById = new Map(parts.map((part) => [part.id, part]));
  const motorWheelConnections = connections.filter(
    (connection) => connection.type === "Motor-Wheel"
  );

  return motorWheelConnections.flatMap((connection) => {
    const { parentId: motorId, childId: wheelId } =
      getConnectionPartIds(connection);
    const motor = partById.get(motorId);
    const wheel = partById.get(wheelId);
    const wheelConnections = motorWheelConnections.filter(
      (item) => getConnectionPartIds(item).childId === wheelId
    );

    if (!motor || motor.type !== "Motor" || !wheel || wheel.type !== "Wheel") {
      return [];
    }

    const support = resolveMotorMechanicalSupport(
      motor,
      parts,
      connections,
      foundation
    );

    if (
      !support.supported ||
      wheel.parentAttachmentId !== connection.id ||
      wheelConnections.length !== 1
    ) {
      return [];
    }

    return [
      {
        motorId,
        wheelId,
        motor,
        wheel,
        mountingZoneId: support.mountingZoneId,
        mountingLocation: support.mountingLocation,
      },
    ];
  });
}

function getRequiredAssignmentMessage(side: DrivetrainSide, count: number) {
  const label = sideLabels[side];
  return `${label} drive group requires ${count} powered wheel ${
    count === 1 ? "assembly" : "assemblies"
  }.`;
}

function isValidAssignment(
  assignment: DrivetrainAssignment,
  assemblies: PoweredWheelAssembly[]
): boolean {
  return assemblies.some(
    (assembly) =>
      assembly.motorId === assignment.motorId &&
      assembly.wheelId === assignment.wheelId
  );
}

export function validateDrivetrain(
  configuration: DrivetrainConfiguration,
  parts: readonly RobotPart[],
  connections: readonly RobotConnection[],
  foundation: FoundationConfig | null
): DrivetrainValidation {
  const errors = new Set<string>();
  const requiredCount = getDrivetrainSlotCount(configuration.type);
  const assemblies = getPoweredWheelAssemblies(
    parts,
    connections,
    foundation
  );
  const motorsById = new Map(
    parts.filter((part) => part.type === "Motor").map((part) => [part.id, part])
  );
  const wheelsById = new Map(
    parts.filter((part) => part.type === "Wheel").map((part) => [part.id, part])
  );
  const assignments = [
    ...configuration.left.map((assignment) => ({
      assignment,
      side: "left" as const,
    })),
    ...configuration.right.map((assignment) => ({
      assignment,
      side: "right" as const,
    })),
  ].filter(
    (
      item
    ): item is {
      assignment: DrivetrainAssignment;
      side: DrivetrainSide;
    } => item.assignment !== null
  );
  const motorOwners = new Map<string, DrivetrainSide>();
  const wheelOwners = new Map<string, DrivetrainSide>();

  if (!foundation) errors.add("A foundation is required before configuring a drivetrain.");

  for (const { assignment, side } of assignments) {
    const motor = motorsById.get(assignment.motorId);
    const wheel = wheelsById.get(assignment.wheelId);
    const motorWheelConnections = connections.filter((connection) => {
      if (connection.type !== "Motor-Wheel") return false;
      const { parentId, childId } = getConnectionPartIds(connection);
      return parentId === assignment.motorId && childId === assignment.wheelId;
    });
    const wheelAttachments = connections.filter((connection) => {
      if (connection.type !== "Motor-Wheel") return false;
      return getConnectionPartIds(connection).childId === assignment.wheelId;
    });

    if (!motor) {
      errors.add("The selected motor is no longer installed.");
    } else if (
      !foundation ||
      !resolveMotorMechanicalSupport(motor, parts, connections, foundation)
        .supported
    ) {
      errors.add(`${motor.name} is not mounted to the foundation.`);
    }

    if (!wheel) {
      errors.add("The selected wheel is no longer installed.");
    }

    if (motor && wheel) {
      if (motorWheelConnections.length === 0) {
        const hasAnyMountedWheel = connections.some((connection) => {
          if (connection.type !== "Motor-Wheel") return false;
          return getConnectionPartIds(connection).parentId === motor.id;
        });
        errors.add(
          hasAnyMountedWheel
            ? `The selected wheel is not mounted to ${motor.name}.`
            : `${motor.name} has no mounted wheel.`
        );
      } else if (
        motorWheelConnections.length !== 1 ||
        wheelAttachments.length !== 1 ||
        wheel.parentAttachmentId !== motorWheelConnections[0].id
      ) {
        errors.add(`The wheel-to-motor attachment for ${motor.name} is invalid.`);
      }
    }

    const existingMotorSide = motorOwners.get(assignment.motorId);
    if (existingMotorSide) {
      errors.add(`${motor?.name ?? "A motor"} is assigned more than once.`);
    } else {
      motorOwners.set(assignment.motorId, side);
    }

    const existingWheelSide = wheelOwners.get(assignment.wheelId);
    if (existingWheelSide) {
      errors.add(
        existingWheelSide === side
          ? `${wheel?.name ?? "A wheel"} is assigned more than once.`
          : `This wheel is already assigned to the ${existingWheelSide} drive group.`
      );
    } else {
      wheelOwners.set(assignment.wheelId, side);
    }
  }

  for (const side of ["left", "right"] as const) {
    const sideAssignments = configuration[side];
    const validCount = sideAssignments.filter(
      (assignment) =>
        assignment !== null && isValidAssignment(assignment, assemblies)
    ).length;

    if (validCount < requiredCount) {
      errors.add(getRequiredAssignmentMessage(side, requiredCount));
    }
    if (sideAssignments.length > requiredCount) {
      errors.add(
        `${sideLabels[side]} drive group supports ${requiredCount} powered wheel ${
          requiredCount === 1 ? "assembly" : "assemblies"
        }.`
      );
    }
  }

  return {
    isValid: errors.size === 0,
    errors: [...errors],
  };
}

export function suggestDrivetrainMapping(
  type: DrivetrainType,
  parts: RobotPart[],
  connections: RobotConnection[],
  foundation: FoundationConfig | null
): DrivetrainConfiguration {
  const slotCount = getDrivetrainSlotCount(type);
  const assemblies = getPoweredWheelAssemblies(
    parts,
    connections,
    foundation
  );
  const preferredZones = {
    left: ["front-left", "rear-left"],
    right: ["front-right", "rear-right"],
  } as const;
  const assignments = {
    left: Array<DrivetrainAssignment | null>(slotCount).fill(null),
    right: Array<DrivetrainAssignment | null>(slotCount).fill(null),
  };
  const usedMotorIds = new Set<string>();
  const usedWheelIds = new Set<string>();

  for (const side of ["left", "right"] as const) {
    for (const zoneId of preferredZones[side]) {
      if (assignments[side].every((assignment) => assignment !== null)) break;
      const assembly = assemblies.find(
        (candidate) =>
          candidate.mountingZoneId === zoneId &&
          !usedMotorIds.has(candidate.motorId) &&
          !usedWheelIds.has(candidate.wheelId)
      );
      if (!assembly) continue;

      assignments[side][assignments[side].findIndex((item) => item === null)] = {
        motorId: assembly.motorId,
        wheelId: assembly.wheelId,
      };
      usedMotorIds.add(assembly.motorId);
      usedWheelIds.add(assembly.wheelId);
    }

    // Fill any remaining slots with structurally-mounted motors matching side (+Z = left, -Z = right)
    const remainingSideAssemblies = assemblies
      .filter(
        (candidate) =>
          !usedMotorIds.has(candidate.motorId) &&
          !usedWheelIds.has(candidate.wheelId) &&
          (side === "left"
            ? candidate.motor.position[2] >= 0
            : candidate.motor.position[2] < 0)
      )
      .sort((a, b) => b.motor.position[0] - a.motor.position[0]);

    for (const assembly of remainingSideAssemblies) {
      const nextEmptyIndex = assignments[side].findIndex((item) => item === null);
      if (nextEmptyIndex === -1) break;
      assignments[side][nextEmptyIndex] = {
        motorId: assembly.motorId,
        wheelId: assembly.wheelId,
      };
      usedMotorIds.add(assembly.motorId);
      usedWheelIds.add(assembly.wheelId);
    }
  }

  return {
    type,
    left: assignments.left,
    right: assignments.right,
    mappingCustomized: false,
  };
}

export function retainValidDrivetrainAssignments(
  configuration: DrivetrainConfiguration,
  parts: RobotPart[],
  connections: RobotConnection[],
  foundation: FoundationConfig | null
): DrivetrainConfiguration {
  const validAssemblies = new Set(
    getPoweredWheelAssemblies(parts, connections, foundation).map(
      getDrivetrainAssignmentKey
    )
  );
  const assignedMotors = new Set<string>();
  const assignedWheels = new Set<string>();
  const next: DrivetrainConfiguration = {
    ...configuration,
    left: configuration.left.map((assignment) => {
      if (
        !assignment ||
        !validAssemblies.has(getDrivetrainAssignmentKey(assignment)) ||
        assignedMotors.has(assignment.motorId) ||
        assignedWheels.has(assignment.wheelId)
      ) {
        return null;
      }
      assignedMotors.add(assignment.motorId);
      assignedWheels.add(assignment.wheelId);
      return assignment;
    }),
    right: configuration.right.map((assignment) => {
      if (
        !assignment ||
        !validAssemblies.has(getDrivetrainAssignmentKey(assignment)) ||
        assignedMotors.has(assignment.motorId) ||
        assignedWheels.has(assignment.wheelId)
      ) {
        return null;
      }
      assignedMotors.add(assignment.motorId);
      assignedWheels.add(assignment.wheelId);
      return assignment;
    }),
  };
  return next;
}
