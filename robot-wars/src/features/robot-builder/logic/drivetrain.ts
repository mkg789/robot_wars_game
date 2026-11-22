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

function hasFoundationMount(
  motor: RobotPart,
  connections: RobotConnection[],
  foundation: FoundationConfig
): boolean {
  if (!motor.mountingZoneId) return false;
  const validZone = generateMotorMountZones(foundation).some(
    (zone) => zone.id === motor.mountingZoneId
  );
  const foundationConnection = connections.some((connection) => {
    if (connection.type !== "Mechanical") return false;
    const { parentId, childId } = getConnectionPartIds(connection);
    return parentId === "foundation-chassis" && childId === motor.id;
  });
  return validZone && foundationConnection;
}

export function getPoweredWheelAssemblies(
  parts: RobotPart[],
  connections: RobotConnection[],
  foundation: FoundationConfig | null
): PoweredWheelAssembly[] {
  if (!foundation) return [];

  const partById = new Map(parts.map((part) => [part.id, part]));
  const zones = new Map(
    generateMotorMountZones(foundation).map((zone) => [zone.id, zone])
  );
  const motorWheelConnections = connections.filter(
    (connection) => connection.type === "Motor-Wheel"
  );

  return motorWheelConnections.flatMap((connection) => {
    const { parentId: motorId, childId: wheelId } =
      getConnectionPartIds(connection);
    const motor = partById.get(motorId);
    const wheel = partById.get(wheelId);
    const zone = motor?.mountingZoneId
      ? zones.get(motor.mountingZoneId)
      : undefined;
    const wheelConnections = motorWheelConnections.filter(
      (item) => getConnectionPartIds(item).childId === wheelId
    );

    if (
      !motor ||
      motor.type !== "Motor" ||
      !wheel ||
      wheel.type !== "Wheel" ||
      !zone ||
      !hasFoundationMount(motor, connections, foundation) ||
      wheel.parentAttachmentId !== connection.id ||
      wheelConnections.length !== 1
    ) {
      return [];
    }

    return [{
      motorId,
      wheelId,
      motor,
      wheel,
      mountingZoneId: zone.id,
      mountingLocation: zone.name,
    }];
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
  parts: RobotPart[],
  connections: RobotConnection[],
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
      !hasFoundationMount(motor, connections, foundation)
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
