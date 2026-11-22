import type { RobotPart } from "../types/robot.types";

export type CameraFocusFrame = {
  target: [number, number, number];
  radius: number;
};

export type CameraFocusRequest = CameraFocusFrame & {
  key: number;
};

function getPartRadius(part: RobotPart): number {
  const [sizeX, sizeY, sizeZ] = part.size.map((value) =>
    Number.isFinite(value) ? Math.abs(value) : 0
  );
  const radius =
    part.type === "Wheel"
      ? Math.hypot(sizeX, sizeY * 0.5, sizeZ)
      : Math.hypot(sizeX * 0.5, sizeY * 0.5, sizeZ * 0.5);

  return Math.max(0.2, radius);
}

export function getComponentFocusFrame(part: RobotPart): CameraFocusFrame {
  return {
    target: part.position,
    radius: getPartRadius(part),
  };
}

export function getAssemblyFocusFrame(
  parts: RobotPart[]
): CameraFocusFrame | null {
  if (parts.length === 0) return null;

  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];

  for (const part of parts) {
    const radius = getPartRadius(part);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], part.position[axis] - radius);
      max[axis] = Math.max(max[axis], part.position[axis] + radius);
    }
  }

  const halfExtents: [number, number, number] = [
    (max[0] - min[0]) * 0.5,
    (max[1] - min[1]) * 0.5,
    (max[2] - min[2]) * 0.5,
  ];

  return {
    target: [
      (max[0] + min[0]) * 0.5,
      (max[1] + min[1]) * 0.5,
      (max[2] + min[2]) * 0.5,
    ],
    radius: Math.max(0.3, Math.hypot(...halfExtents)),
  };
}

export function getVisibleSelectedPart(
  parts: RobotPart[],
  selectedId: string | null,
  hiddenPartIds: string[]
): RobotPart | null {
  if (!selectedId || hiddenPartIds.includes(selectedId)) return null;
  return parts.find((part) => part.id === selectedId) ?? null;
}

export function getCameraFocusDistance(
  radius: number,
  fieldOfViewDegrees: number,
  aspectRatio: number
): number {
  const safeRadius = Number.isFinite(radius) ? Math.max(0.2, radius) : 0.2;
  const safeFieldOfView = Number.isFinite(fieldOfViewDegrees)
    ? Math.max(1, Math.min(120, fieldOfViewDegrees))
    : 44;
  const safeAspectRatio = Number.isFinite(aspectRatio)
    ? Math.max(0.1, aspectRatio)
    : 1;
  const verticalHalfAngle = (safeFieldOfView * Math.PI) / 360;
  const horizontalHalfAngle = Math.atan(
    Math.tan(verticalHalfAngle) * safeAspectRatio
  );
  const limitingHalfAngle = Math.min(
    verticalHalfAngle,
    horizontalHalfAngle
  );

  return Math.max(
    0.35,
    (safeRadius / Math.sin(limitingHalfAngle)) * 1.15
  );
}
