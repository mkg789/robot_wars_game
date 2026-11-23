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
