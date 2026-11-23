import type {
  FoundationConfig,
  MotorMountZone,
  MotorCatalogueId,
} from "../types/robot.types";

export function generateMotorMountZones(
  foundation: FoundationConfig
): MotorMountZone[] {
  const halfLength = foundation.length / 2;
  const halfWidth = foundation.width / 2;
  const y = foundation.height + 0.16;
  const xInset = Math.min(halfLength - 0.28, halfLength * 0.55);
  const zInset = Math.max(
    0.18,
    Math.min(halfWidth - 0.24, halfWidth * 0.58)
  );

  const positions: Array<{
    id: string;
    name: string;
    position: [number, number, number];
    rotation: [number, number, number];
  }> = [
    {
      id: "front-left",
      name: "Front Left",
      position: [xInset, y, zInset],
      rotation: [0, -Math.PI / 2, 0],
    },
    {
      id: "front-right",
      name: "Front Right",
      position: [xInset, y, -zInset],
      rotation: [0, Math.PI / 2, 0],
    },
    {
      id: "rear-left",
      name: "Rear Left",
      position: [-xInset, y, zInset],
      rotation: [0, -Math.PI / 2, 0],
    },
    {
      id: "rear-right",
      name: "Rear Right",
      position: [-xInset, y, -zInset],
      rotation: [0, Math.PI / 2, 0],
    },
  ];

  return positions.map((zone) => ({
    ...zone,
    accepts: [
      "small-dc",
      "standard-dc",
      "high-torque-dc",
    ] as MotorCatalogueId[],
  }));
}

export function isMountZoneInsideFoundation(
  zone: MotorMountZone,
  foundation: FoundationConfig
): boolean {
  return (
    Math.abs(zone.position[0]) <= foundation.length / 2 &&
    Math.abs(zone.position[2]) <= foundation.width / 2 &&
    zone.position[1] >= 0 &&
    zone.position[1] <= foundation.height + 1
  );
}
