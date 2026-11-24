/**
 * Shared measurement formatting utilities for Robot Wars.
 *
 * Formats physical measurements (length, mass, multi-dimensional extents)
 * into consistent, localized display strings with explicit unit suffixes.
 *
 * Base canonical units:
 * - Length: meters (m)
 * - Mass: kilograms (kg)
 */

import {
  kgToGrams,
  metersToCm,
  metersToMm,
} from "./units";

export * from "./units";

export type LengthUnit = "m" | "cm" | "mm";
export type MassUnit = "kg" | "g";

export type FormatLengthOptions = {
  decimals?: number;
  includeUnit?: boolean;
  trimTrailingZeros?: boolean;
};

export type FormatMassOptions = {
  decimals?: number;
  includeUnit?: boolean;
  trimTrailingZeros?: boolean;
};

export type DimensionsObject =
  | { length: number; width: number; height: number }
  | { length: number; height: number; width: number }
  | { x: number; y: number; z: number };

export type DimensionsInput =
  | readonly [number, number, number]
  | readonly [number, number]
  | DimensionsObject;

export type FormatDimensionsOptions = {
  decimals?: number | number[];
  trimTrailingZeros?: boolean;
  separator?: string;
};

function formatNumber(
  val: number,
  decimals: number,
  trimTrailingZeros: boolean
): string {
  if (!Number.isFinite(val)) return "-";
  const str = val.toFixed(decimals);
  if (trimTrailingZeros && str.includes(".")) {
    return str.replace(/\.?0+$/, "");
  }
  return str;
}

/**
 * Format a length measurement from canonical meters into the target unit with suffix.
 */
export function formatLength(
  meters: number,
  unit: LengthUnit = "m",
  options: FormatLengthOptions = {}
): string {
  const {
    includeUnit = true,
    trimTrailingZeros = false,
  } = options;

  let value: number;
  let defaultDecimals: number;

  switch (unit) {
    case "cm":
      value = metersToCm(meters);
      defaultDecimals = 1;
      break;
    case "mm":
      value = metersToMm(meters);
      defaultDecimals = 1;
      break;
    case "m":
    default:
      value = meters;
      defaultDecimals = 2;
      break;
  }

  const decimals = options.decimals ?? defaultDecimals;
  const formatted = formatNumber(value, decimals, trimTrailingZeros);

  return includeUnit ? `${formatted} ${unit}` : formatted;
}

/**
 * Format a mass measurement from canonical kilograms into the target unit with suffix.
 */
export function formatMass(
  kg: number,
  unit: MassUnit = "kg",
  options: FormatMassOptions = {}
): string {
  const {
    includeUnit = true,
    trimTrailingZeros = false,
  } = options;

  let value: number;
  let defaultDecimals: number;

  switch (unit) {
    case "g":
      value = kgToGrams(kg);
      defaultDecimals = 0;
      break;
    case "kg":
    default:
      value = kg;
      defaultDecimals = 2;
      break;
  }

  const decimals = options.decimals ?? defaultDecimals;
  const formatted = formatNumber(value, decimals, trimTrailingZeros);

  return includeUnit ? `${formatted} ${unit}` : formatted;
}

/**
 * Format a 2D or 3D dimensional measurement in the caller's specified coordinate order.
 */
export function formatDimensions(
  dimensions: DimensionsInput,
  unit: LengthUnit = "m",
  options: FormatDimensionsOptions = {}
): string {
  const {
    decimals,
    trimTrailingZeros = false,
    separator = " × ",
  } = options;

  let values: number[];
  if (Array.isArray(dimensions)) {
    values = [...dimensions];
  } else if ("length" in dimensions && "width" in dimensions && "height" in dimensions) {
    values = [dimensions.length, dimensions.width, dimensions.height];
  } else if ("x" in dimensions && "y" in dimensions && "z" in dimensions) {
    values = [dimensions.x, dimensions.y, dimensions.z];
  } else {
    values = [];
  }

  const formattedValues = values.map((val, index) => {
    const d = Array.isArray(decimals)
      ? decimals[index] ?? decimals[decimals.length - 1]
      : decimals;
    return formatLength(val, unit, {
      decimals: d,
      includeUnit: false,
      trimTrailingZeros,
    });
  });

  return `${formattedValues.join(separator)} ${unit}`;
}

export type SpeedUnit = "m/s" | "km/h";

export type FormatSpeedOptions = {
  decimals?: number;
  includeUnit?: boolean;
  trimTrailingZeros?: boolean;
};

/**
 * Format linear speed from canonical meters per second (m/s).
 */
export function formatSpeed(
  mps?: number | null,
  unit: SpeedUnit = "m/s",
  options: FormatSpeedOptions = {}
): string {
  if (mps === undefined || mps === null || !Number.isFinite(mps)) return "-";
  const { includeUnit = true, trimTrailingZeros = false } = options;

  let value = mps;
  let defaultDecimals = 2;

  if (unit === "km/h") {
    value = mps * 3.6;
    defaultDecimals = 1;
  }

  const decimals = options.decimals ?? defaultDecimals;
  const formatted = formatNumber(value, decimals, trimTrailingZeros);
  return includeUnit ? `${formatted} ${unit}` : formatted;
}

export type ForceUnit = "N" | "kgf";

export type FormatForceOptions = {
  decimals?: number;
  includeUnit?: boolean;
  trimTrailingZeros?: boolean;
};

/**
 * Format push force from canonical Newtons (N).
 */
export function formatForce(
  newtons?: number | null,
  unit: ForceUnit = "N",
  options: FormatForceOptions = {}
): string {
  if (newtons === undefined || newtons === null || !Number.isFinite(newtons)) return "-";
  const { includeUnit = true, trimTrailingZeros = false } = options;

  let value = newtons;
  let defaultDecimals = 1;

  if (unit === "kgf") {
    value = newtons / 9.80665;
    defaultDecimals = 2;
  }

  const decimals = options.decimals ?? defaultDecimals;
  const formatted = formatNumber(value, decimals, trimTrailingZeros);
  return includeUnit ? `${formatted} ${unit}` : formatted;
}

export type AccelerationUnit = "m/s²" | "g";

export type FormatAccelerationOptions = {
  decimals?: number;
  includeUnit?: boolean;
  trimTrailingZeros?: boolean;
};

/**
 * Format acceleration from canonical m/s².
 */
export function formatAcceleration(
  mps2?: number | null,
  unit: AccelerationUnit = "m/s²",
  options: FormatAccelerationOptions = {}
): string {
  if (mps2 === undefined || mps2 === null || !Number.isFinite(mps2)) return "-";
  const { includeUnit = true, trimTrailingZeros = false } = options;

  let value = mps2;
  let defaultDecimals = 2;

  if (unit === "g") {
    value = mps2 / 9.80665;
    defaultDecimals = 2;
  }

  const decimals = options.decimals ?? defaultDecimals;
  const formatted = formatNumber(value, decimals, trimTrailingZeros);
  return includeUnit ? `${formatted} ${unit}` : formatted;
}

export type YawRateUnit = "°/s" | "deg/s" | "rad/s";

export type FormatYawRateOptions = {
  decimals?: number;
  includeUnit?: boolean;
  trimTrailingZeros?: boolean;
};

/**
 * Format yaw turning rate from canonical degrees per second (°/s).
 */
export function formatYawRate(
  degPerSec?: number | null,
  unit: YawRateUnit = "°/s",
  options: FormatYawRateOptions = {}
): string {
  if (degPerSec === undefined || degPerSec === null || !Number.isFinite(degPerSec)) return "-";
  const { includeUnit = true, trimTrailingZeros = false } = options;

  let value = degPerSec;
  let defaultDecimals = 0;

  if (unit === "rad/s") {
    value = degPerSec * (Math.PI / 180);
    defaultDecimals = 2;
  }

  const decimals = options.decimals ?? defaultDecimals;
  const formatted = formatNumber(value, decimals, trimTrailingZeros);
  return includeUnit ? `${formatted} ${unit}` : formatted;
}

export type AngleUnit = "°" | "deg" | "rad";

export type FormatAngleOptions = {
  decimals?: number;
  includeUnit?: boolean;
  trimTrailingZeros?: boolean;
};

/**
 * Format planar angle from canonical degrees (°).
 */
export function formatAngle(
  degrees?: number | null,
  unit: AngleUnit = "°",
  options: FormatAngleOptions = {}
): string {
  if (degrees === undefined || degrees === null || !Number.isFinite(degrees)) return "-";
  const { includeUnit = true, trimTrailingZeros = false } = options;

  let value = degrees;
  let defaultDecimals = 1;

  if (unit === "rad") {
    value = degrees * (Math.PI / 180);
    defaultDecimals = 3;
  }

  const decimals = options.decimals ?? defaultDecimals;
  const formatted = formatNumber(value, decimals, trimTrailingZeros);
  if (!includeUnit) return formatted;
  return unit === "°" ? `${formatted}°` : `${formatted} ${unit}`;
}

export type FormatPercentageOptions = {
  decimals?: number;
  includeUnit?: boolean;
  trimTrailingZeros?: boolean;
};

/**
 * Format dimensionless fraction (e.g. 0.25 -> 25%) to percentage string.
 */
export function formatPercentage(
  fraction?: number | null,
  options: FormatPercentageOptions = {}
): string {
  if (fraction === undefined || fraction === null || !Number.isFinite(fraction)) return "-";
  const { includeUnit = true, trimTrailingZeros = false } = options;

  const value = fraction * 100;
  const decimals = options.decimals ?? 0;
  const formatted = formatNumber(value, decimals, trimTrailingZeros);
  return includeUnit ? `${formatted}%` : formatted;
}

export type InertiaUnit = "kg·m²" | "kg*m^2";

export type FormatInertiaOptions = {
  decimals?: number;
  includeUnit?: boolean;
  trimTrailingZeros?: boolean;
};

/**
 * Format moment of inertia from canonical kilogram-square-meters (kg·m²).
 */
export function formatInertia(
  kgM2?: number | null,
  unit: InertiaUnit = "kg·m²",
  options: FormatInertiaOptions = {}
): string {
  if (kgM2 === undefined || kgM2 === null || !Number.isFinite(kgM2)) return "-";
  const { includeUnit = true, trimTrailingZeros = false } = options;

  const decimals = options.decimals ?? 4;
  const formatted = formatNumber(kgM2, decimals, trimTrailingZeros);
  return includeUnit ? `${formatted} ${unit}` : formatted;
}
