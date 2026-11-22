import { describe, expect, it } from "vitest";

import type {
  DrivetrainAssignment,
  DrivetrainConfiguration,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";
import {
  getPoweredWheelAssemblies,
  suggestDrivetrainMapping,
  validateDrivetrain,
} from "./drivetrain";

const foundation: FoundationConfig = {
  modelId: "standard-rectangular",
  length: 1.8,
  width: 1.1,
  height: 0.24,
  includeTopPlate: true,
  includeFrontCover: false,
  confirmed: true,
};

function createAssembly(zoneId: string): {
  motor: RobotPart;
  wheel: RobotPart;
  connections: RobotConnection[];
  assignment: DrivetrainAssignment;
} {
  const motorId = `motor-${zoneId}`;
  const wheelId = `wheel-${zoneId}`;
  const connectionId = `connection-${zoneId}`;
  const motor: RobotPart = {
    id: motorId,
    name: `Motor ${zoneId}`,
    type: "Motor",
    position: [0, 0.4, 0],
    rotation: [0, 0, 0],
    size: [0.4, 0.3, 0.5],
    color: "#f00",
    mass: 0.5,
    mountingZoneId: zoneId,
  };
  const wheel: RobotPart = {
    id: wheelId,
    name: `Wheel ${zoneId}`,
    type: "Wheel",
    position: [0, 0.4, 0],
    rotation: [0, 0, 0],
    size: [0.11, 0.07, 0.11],
    color: "#111",
    mass: 0.1,
    parentAttachmentId: connectionId,
  };
  const connections: RobotConnection[] = [
    {
      id: `foundation-${zoneId}`,
      sourceId: "foundation-chassis",
      targetId: motorId,
      parentId: "foundation-chassis",
      childId: motorId,
      parentMountPointId: "foundation-zone",
      childMountPointId: "motor-mount",
      relativePosition: [0, 0, 0],
      relativeRotation: [0, 0, 0],
      type: "Mechanical",
    },
    {
      id: connectionId,
      sourceId: motorId,
      targetId: wheelId,
      parentId: motorId,
      childId: wheelId,
      parentMountPointId: "motor-shaft",
      childMountPointId: "wheel-hub",
      relativePosition: [0, 0, 0],
      relativeRotation: [0, 0, 0],
      type: "Motor-Wheel",
    },
  ];

  return {
    motor,
    wheel,
    connections,
    assignment: { motorId, wheelId },
  };
}

function createConfiguration(
  type: DrivetrainConfiguration["type"],
  left: Array<DrivetrainAssignment | null>,
  right: Array<DrivetrainAssignment | null>
): DrivetrainConfiguration {
  return { type, left, right, mappingCustomized: true };
}

function createAssemblySet(zoneIds: string[]) {
  const assemblies = zoneIds.map(createAssembly);
  return {
    parts: assemblies.flatMap(({ motor, wheel }) => [motor, wheel]),
    connections: assemblies.flatMap((assembly) => assembly.connections),
    assignments: assemblies.map((assembly) => assembly.assignment),
  };
}

describe("drivetrain configuration", () => {
  it("suggests and validates a 2-wheel differential mapping", () => {
    const data = createAssemblySet([
      "front-left",
      "front-right",
      "rear-left",
      "rear-right",
    ]);
    const configuration = suggestDrivetrainMapping(
      "differential-2",
      data.parts,
      data.connections,
      foundation
    );

    expect(configuration.left[0]).toEqual(data.assignments[0]);
    expect(configuration.right[0]).toEqual(data.assignments[1]);
    expect(
      validateDrivetrain(
        configuration,
        data.parts,
        data.connections,
        foundation
      )
    ).toEqual({ isValid: true, errors: [] });
  });

  it("suggests both mounted wheels per side for 4-wheel differential drive", () => {
    const data = createAssemblySet([
      "front-left",
      "front-right",
      "rear-left",
      "rear-right",
    ]);
    const configuration = suggestDrivetrainMapping(
      "differential-4",
      data.parts,
      data.connections,
      foundation
    );

    expect(configuration.left).toEqual([
      data.assignments[0],
      data.assignments[2],
    ]);
    expect(configuration.right).toEqual([
      data.assignments[1],
      data.assignments[3],
    ]);
    expect(
      validateDrivetrain(
        configuration,
        data.parts,
        data.connections,
        foundation
      ).isValid
    ).toBe(true);
  });

  it("uses rear-mounted pairs when a 2-wheel front-side suggestion is unavailable", () => {
    const data = createAssemblySet(["rear-left", "rear-right"]);
    const configuration = suggestDrivetrainMapping(
      "differential-2",
      data.parts,
      data.connections,
      foundation
    );

    expect(configuration.left[0]).toEqual(data.assignments[0]);
    expect(configuration.right[0]).toEqual(data.assignments[1]);
  });

  it("reports incomplete side counts and invalid component references", () => {
    const data = createAssemblySet(["front-left"]);
    const configuration = createConfiguration(
      "differential-2",
      [{ motorId: "missing-motor", wheelId: data.assignments[0].wheelId }],
      [{ motorId: data.assignments[0].motorId, wheelId: "missing-wheel" }]
    );

    const result = validateDrivetrain(
      configuration,
      data.parts,
      data.connections,
      foundation
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("The selected motor is no longer installed.");
    expect(result.errors).toContain("The selected wheel is no longer installed.");
    expect(result.errors).toContain(
      "Left drive group requires 1 powered wheel assembly."
    );
    expect(result.errors).toContain(
      "Right drive group requires 1 powered wheel assembly."
    );
  });

  it("rejects a motor without a mounted wheel and stale wheel attachments", () => {
    const data = createAssemblySet(["front-left", "front-right"]);
    const staleWheel = {
      ...data.parts.find((part) => part.id === data.assignments[1].wheelId)!,
      parentAttachmentId: "stale-connection",
    };
    const parts = data.parts.map((part) =>
      part.id === staleWheel.id ? staleWheel : part
    );
    const connections = data.connections.filter(
      (connection) =>
        !(
          connection.type === "Motor-Wheel" &&
          connection.parentId === data.assignments[0].motorId
        )
    );
    const configuration = createConfiguration(
      "differential-2",
      [data.assignments[0]],
      [data.assignments[1]]
    );

    const result = validateDrivetrain(
      configuration,
      parts,
      connections,
      foundation
    );
    expect(result.errors).toContain(
      `${data.parts.find((part) => part.id === data.assignments[0].motorId)?.name} has no mounted wheel.`
    );
    expect(result.errors).toContain(
      `The wheel-to-motor attachment for ${
        data.parts.find((part) => part.id === data.assignments[1].motorId)?.name
      } is invalid.`
    );
    expect(
      getPoweredWheelAssemblies(parts, connections, foundation)
    ).toHaveLength(0);
  });

  it("detects repeated motor and wheel assignments across sides", () => {
    const data = createAssemblySet(["front-left"]);
    const configuration = createConfiguration(
      "differential-2",
      [data.assignments[0]],
      [data.assignments[0]]
    );
    const errors = validateDrivetrain(
      configuration,
      data.parts,
      data.connections,
      foundation
    ).errors;

    expect(errors).toContain(
      `${data.parts.find((part) => part.id === data.assignments[0].motorId)?.name} is assigned more than once.`
    );
    expect(errors).toContain(
      "This wheel is already assigned to the left drive group."
    );
  });

  it("requires two assemblies on both sides for 4-wheel drive", () => {
    const data = createAssemblySet(["front-left", "front-right"]);
    const configuration = createConfiguration(
      "differential-4",
      [data.assignments[0], null],
      [data.assignments[1], null]
    );

    const errors = validateDrivetrain(
      configuration,
      data.parts,
      data.connections,
      foundation
    ).errors;
    expect(errors).toContain(
      "Left drive group requires 2 powered wheel assemblies."
    );
    expect(errors).toContain(
      "Right drive group requires 2 powered wheel assemblies."
    );
  });
});
