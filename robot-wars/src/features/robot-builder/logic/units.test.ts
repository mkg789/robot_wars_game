import { describe, expect, it } from "vitest";

import {
  cmToMeters,
  gramsToKg,
  kgToGrams,
  metersToCm,
  metersToMm,
  mmToMeters,
} from "./units";

describe("unit conversion utilities", () => {
  describe("metersToCm", () => {
    it("converts meters to centimeters", () => {
      expect(metersToCm(1)).toBe(100);
      expect(metersToCm(0.22)).toBe(22);
      expect(metersToCm(1.5)).toBe(150);
      expect(metersToCm(0.07)).toBeCloseTo(7);
    });

    it("handles zero correctly", () => {
      expect(metersToCm(0)).toBe(0);
    });

    it("preserves decimal precision without rounding", () => {
      expect(metersToCm(0.123456)).toBe(12.3456);
    });
  });

  describe("cmToMeters", () => {
    it("converts centimeters to meters", () => {
      expect(cmToMeters(100)).toBe(1);
      expect(cmToMeters(22)).toBe(0.22);
      expect(cmToMeters(7)).toBe(0.07);
      expect(cmToMeters(150)).toBe(1.5);
    });

    it("handles zero correctly", () => {
      expect(cmToMeters(0)).toBe(0);
    });

    it("preserves decimal precision without rounding", () => {
      expect(cmToMeters(12.3456)).toBe(0.123456);
    });
  });

  describe("metersToMm", () => {
    it("converts meters to millimeters", () => {
      expect(metersToMm(1)).toBe(1000);
      expect(metersToMm(0.069)).toBe(69);
      expect(metersToMm(0.054)).toBe(54);
      expect(metersToMm(0.015)).toBe(15);
    });

    it("handles zero correctly", () => {
      expect(metersToMm(0)).toBe(0);
    });

    it("preserves decimal precision without rounding", () => {
      expect(metersToMm(0.001234)).toBe(1.234);
    });
  });

  describe("mmToMeters", () => {
    it("converts millimeters to meters", () => {
      expect(mmToMeters(1000)).toBe(1);
      expect(mmToMeters(69)).toBe(0.069);
      expect(mmToMeters(54)).toBe(0.054);
      expect(mmToMeters(15)).toBe(0.015);
    });

    it("handles zero correctly", () => {
      expect(mmToMeters(0)).toBe(0);
    });

    it("preserves decimal precision without rounding", () => {
      expect(mmToMeters(1.234)).toBe(0.001234);
    });
  });

  describe("kgToGrams", () => {
    it("converts kilograms to grams", () => {
      expect(kgToGrams(1)).toBe(1000);
      expect(kgToGrams(0.025)).toBe(25);
      expect(kgToGrams(0.48)).toBe(480);
      expect(kgToGrams(0.009)).toBe(9);
    });

    it("handles zero correctly", () => {
      expect(kgToGrams(0)).toBe(0);
    });

    it("preserves decimal precision without rounding", () => {
      expect(kgToGrams(0.123456)).toBe(123.456);
    });
  });

  describe("gramsToKg", () => {
    it("converts grams to kilograms", () => {
      expect(gramsToKg(1000)).toBe(1);
      expect(gramsToKg(25)).toBe(0.025);
      expect(gramsToKg(480)).toBe(0.48);
      expect(gramsToKg(9)).toBe(0.009);
    });

    it("handles zero correctly", () => {
      expect(gramsToKg(0)).toBe(0);
    });

    it("preserves decimal precision without rounding", () => {
      expect(gramsToKg(123.456)).toBe(0.123456);
    });
  });

  describe("round-trip conversions", () => {
    it("preserves values across meters <-> centimeters round-trip", () => {
      const values = [0.05, 0.22, 1, 2.5, 10];
      for (const val of values) {
        expect(cmToMeters(metersToCm(val))).toBeCloseTo(val, 10);
        expect(metersToCm(cmToMeters(val))).toBeCloseTo(val, 10);
      }
    });

    it("preserves values across meters <-> millimeters round-trip", () => {
      const values = [0.001, 0.015, 0.069, 0.5, 2];
      for (const val of values) {
        expect(mmToMeters(metersToMm(val))).toBeCloseTo(val, 10);
        expect(metersToMm(mmToMeters(val))).toBeCloseTo(val, 10);
      }
    });

    it("preserves values across kilograms <-> grams round-trip", () => {
      const values = [0.005, 0.025, 0.48, 1.5, 12];
      for (const val of values) {
        expect(gramsToKg(kgToGrams(val))).toBeCloseTo(val, 10);
        expect(kgToGrams(gramsToKg(val))).toBeCloseTo(val, 10);
      }
    });
  });
});
