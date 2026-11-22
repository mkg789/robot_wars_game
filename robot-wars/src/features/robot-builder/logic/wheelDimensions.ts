import type { WheelDimensionDraft } from "../types/robot.types";

export const wheelDimensionBounds = {
  diameterCm: { min: 8, max: 60 },
  widthCm: { min: 3, max: 20 },
} as const;

export function clampWheelDimension(
  value: number,
  previousValue: number,
  bounds: { min: number; max: number }
): number {
  if (!Number.isFinite(value)) return previousValue;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function getWheelDimensionsInMeters(
  dimensions: WheelDimensionDraft
): { diameter: number; width: number } {
  return {
    diameter: dimensions.diameterCm / 100,
    width: dimensions.widthCm / 100,
  };
}
