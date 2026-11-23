/**
 * Centralized, reusable, type-safe unit conversion functions for Robot Wars.
 * Canonical physical units:
 * - Length: meters (m)
 * - Mass: kilograms (kg)
 * - Three.js world unit: 1 meter
 *
 * All functions are pure, preserve raw precision, and do not round internally.
 */

export function metersToCm(meters: number): number {
  return meters * 100;
}

export function cmToMeters(cm: number): number {
  return cm / 100;
}

export function metersToMm(meters: number): number {
  return meters * 1000;
}

export function mmToMeters(mm: number): number {
  return mm / 1000;
}

export function kgToGrams(kg: number): number {
  return kg * 1000;
}

export function gramsToKg(grams: number): number {
  return grams / 1000;
}
