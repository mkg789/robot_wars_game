import { describe, expect, it } from "vitest";
import {
  formatAcceleration,
  formatAngle,
  formatDimensions,
  formatForce,
  formatInertia,
  formatLength,
  formatMass,
  formatPercentage,
  formatSpeed,
  formatYawRate,
  metersToCm,
} from "./formatters";

describe("formatLength", () => {
  it("formats meters with default 2 decimal places and unit suffix", () => {
    expect(formatLength(1.2345)).toBe("1.23 m");
    expect(formatLength(0.5)).toBe("0.50 m");
  });

  it("formats centimeters with default 1 decimal place and unit suffix", () => {
    expect(formatLength(0.1, "cm")).toBe("10.0 cm");
    expect(formatLength(0.055, "cm")).toBe("5.5 cm");
  });

  it("formats millimeters with default 1 decimal place and unit suffix", () => {
    expect(formatLength(0.025, "mm")).toBe("25.0 mm");
    expect(formatLength(0.001, "mm")).toBe("1.0 mm");
  });

  it("honors custom decimal places", () => {
    expect(formatLength(0.1, "cm", { decimals: 0 })).toBe("10 cm");
    expect(formatLength(0.0254, "mm", { decimals: 2 })).toBe("25.40 mm");
    expect(formatLength(1.5, "m", { decimals: 3 })).toBe("1.500 m");
  });

  it("supports suppressing the unit suffix", () => {
    expect(formatLength(1.5, "m", { includeUnit: false })).toBe("1.50");
    expect(formatLength(0.1, "cm", { decimals: 0, includeUnit: false })).toBe("10");
  });

  it("supports trimming trailing zeros", () => {
    expect(formatLength(1.5, "m", { trimTrailingZeros: true })).toBe("1.5 m");
    expect(formatLength(1.0, "m", { trimTrailingZeros: true })).toBe("1 m");
    expect(formatLength(1.25, "m", { trimTrailingZeros: true })).toBe("1.25 m");
  });

  it("handles zero values", () => {
    expect(formatLength(0, "m")).toBe("0.00 m");
    expect(formatLength(0, "cm", { decimals: 0 })).toBe("0 cm");
    expect(formatLength(0, "mm", { trimTrailingZeros: true })).toBe("0 mm");
  });

  it("handles negative values", () => {
    expect(formatLength(-0.5, "m")).toBe("-0.50 m");
    expect(formatLength(-0.1, "cm", { decimals: 0 })).toBe("-10 cm");
  });

  it("handles non-finite values gracefully", () => {
    expect(formatLength(NaN, "m")).toBe("- m");
    expect(formatLength(Infinity, "cm")).toBe("- cm");
  });
});

describe("formatMass", () => {
  it("formats kilograms with default 2 decimal places and unit suffix", () => {
    expect(formatMass(2.5)).toBe("2.50 kg");
    expect(formatMass(0.85)).toBe("0.85 kg");
  });

  it("formats grams with default 0 decimal places and unit suffix", () => {
    expect(formatMass(0.05, "g")).toBe("50 g");
    expect(formatMass(0.125, "g")).toBe("125 g");
  });

  it("honors custom decimal places", () => {
    expect(formatMass(0.0505, "g", { decimals: 1 })).toBe("50.5 g");
    expect(formatMass(2.5, "kg", { decimals: 1 })).toBe("2.5 kg");
    expect(formatMass(2.5, "kg", { decimals: 3 })).toBe("2.500 kg");
  });

  it("supports suppressing the unit suffix", () => {
    expect(formatMass(1.25, "kg", { includeUnit: false })).toBe("1.25");
    expect(formatMass(0.5, "g", { includeUnit: false })).toBe("500");
  });

  it("supports trimming trailing zeros", () => {
    expect(formatMass(2.0, "kg", { trimTrailingZeros: true })).toBe("2 kg");
    expect(formatMass(2.5, "kg", { trimTrailingZeros: true })).toBe("2.5 kg");
  });

  it("handles zero values", () => {
    expect(formatMass(0, "kg")).toBe("0.00 kg");
    expect(formatMass(0, "g")).toBe("0 g");
  });

  it("handles negative values", () => {
    expect(formatMass(-1.5, "kg")).toBe("-1.50 kg");
    expect(formatMass(-0.02, "g")).toBe("-20 g");
  });

  it("handles non-finite values gracefully", () => {
    expect(formatMass(NaN, "kg")).toBe("- kg");
    expect(formatMass(Infinity, "g")).toBe("- g");
  });
});

describe("formatDimensions", () => {
  it("formats 3D tuple in meters", () => {
    expect(formatDimensions([0.5, 0.4, 0.2], "m")).toBe("0.50 × 0.40 × 0.20 m");
  });

  it("formats 3D tuple in centimeters with custom decimals", () => {
    expect(formatDimensions([0.5, 0.4, 0.2], "cm", { decimals: 0 })).toBe(
      "50 × 40 × 20 cm"
    );
  });

  it("formats 2D tuple in centimeters", () => {
    expect(formatDimensions([0.1, 0.05], "cm", { decimals: 1 })).toBe(
      "10.0 × 5.0 cm"
    );
  });

  it("formats object with { length, width, height } in millimeters", () => {
    const dims = { length: 0.1, width: 0.05, height: 0.02 };
    expect(formatDimensions(dims, "mm", { decimals: 1 })).toBe(
      "100.0 × 50.0 × 20.0 mm"
    );
  });

  it("formats object with { x, y, z } in meters", () => {
    const dims = { x: 0.5, y: 0.2, z: 0.3 };
    expect(formatDimensions(dims, "m", { decimals: 2 })).toBe(
      "0.50 × 0.20 × 0.30 m"
    );
  });

  it("supports custom separator", () => {
    expect(formatDimensions([1, 2, 3], "m", { separator: " x " })).toBe(
      "1.00 x 2.00 x 3.00 m"
    );
  });

  it("supports array of decimals per dimension", () => {
    const batteryDims = { length: 0.15, width: 0.08, height: 0.035 };
    expect(
      formatDimensions(batteryDims, "m", { decimals: [2, 2, 3] })
    ).toBe("0.15 × 0.08 × 0.035 m");
  });

  it("supports trimming trailing zeros across dimensions", () => {
    expect(
      formatDimensions([1.5, 2.0, 3.25], "m", { trimTrailingZeros: true })
    ).toBe("1.5 × 2 × 3.25 m");
  });

  it("preserves dimension order specified by caller", () => {
    // Wheel bounding box: [diameter, width, diameter]
    expect(formatDimensions([0.6, 0.15, 0.6], "m", { decimals: 2 })).toBe(
      "0.60 × 0.15 × 0.60 m"
    );
  });

  it("re-exports conversion utilities from units.ts", () => {
    expect(metersToCm(1)).toBe(100);
  });
});

describe("formatSpeed", () => {
  it("formats linear speed in m/s with 2 decimals", () => {
    expect(formatSpeed(2.073)).toBe("2.07 m/s");
    expect(formatSpeed(0)).toBe("0.00 m/s");
  });

  it("formats speed in km/h with 1 decimal", () => {
    expect(formatSpeed(2.07345, "km/h")).toBe("7.5 km/h");
  });

  it("handles undefined or non-finite gracefully", () => {
    expect(formatSpeed(undefined)).toBe("-");
    expect(formatSpeed(NaN)).toBe("-");
  });
});

describe("formatForce", () => {
  it("formats force in N with 1 decimal", () => {
    expect(formatForce(14.53)).toBe("14.5 N");
    expect(formatForce(0)).toBe("0.0 N");
  });

  it("formats force in kgf with 2 decimals", () => {
    expect(formatForce(9.80665, "kgf")).toBe("1.00 kgf");
  });

  it("handles undefined gracefully", () => {
    expect(formatForce(undefined)).toBe("-");
  });
});

describe("formatAcceleration", () => {
  it("formats acceleration in m/s² with 2 decimals", () => {
    expect(formatAcceleration(4.85)).toBe("4.85 m/s²");
  });

  it("formats acceleration in g with 2 decimals", () => {
    expect(formatAcceleration(9.80665, "g")).toBe("1.00 g");
  });

  it("handles undefined gracefully", () => {
    expect(formatAcceleration(undefined)).toBe("-");
  });
});

describe("formatYawRate", () => {
  it("formats yaw rate in °/s with 0 decimals", () => {
    expect(formatYawRate(198.4)).toBe("198 °/s");
  });

  it("formats yaw rate in rad/s", () => {
    expect(formatYawRate(180, "rad/s")).toBe("3.14 rad/s");
  });

  it("handles undefined gracefully", () => {
    expect(formatYawRate(undefined)).toBe("-");
  });
});

describe("formatAngle", () => {
  it("formats angle in ° with default 1 decimal", () => {
    expect(formatAngle(45.67)).toBe("45.7°");
    expect(formatAngle(90)).toBe("90.0°");
  });

  it("formats angle in deg with unit suffix", () => {
    expect(formatAngle(30.25, "deg")).toBe("30.3 deg");
  });

  it("formats angle in rad with 3 decimals", () => {
    expect(formatAngle(180, "rad")).toBe("3.142 rad");
  });

  it("honors custom decimal places and trimming", () => {
    expect(formatAngle(45.5, "°", { decimals: 0 })).toBe("46°");
    expect(formatAngle(45.5, "°", { trimTrailingZeros: true })).toBe("45.5°");
  });

  it("handles undefined, null and non-finite gracefully", () => {
    expect(formatAngle(undefined)).toBe("-");
    expect(formatAngle(null)).toBe("-");
    expect(formatAngle(NaN)).toBe("-");
  });
});

describe("formatPercentage", () => {
  it("formats fraction as percentage with 0 decimals by default", () => {
    expect(formatPercentage(0.6)).toBe("60%");
    expect(formatPercentage(0.25)).toBe("25%");
    expect(formatPercentage(1.0)).toBe("100%");
  });

  it("honors custom decimal places", () => {
    expect(formatPercentage(0.625, { decimals: 1 })).toBe("62.5%");
  });

  it("supports suppressing unit suffix", () => {
    expect(formatPercentage(0.75, { includeUnit: false })).toBe("75");
  });

  it("handles undefined, null and non-finite gracefully", () => {
    expect(formatPercentage(undefined)).toBe("-");
    expect(formatPercentage(null)).toBe("-");
    expect(formatPercentage(NaN)).toBe("-");
  });
});

describe("formatInertia", () => {
  it("formats moment of inertia in kg·m² with default 4 decimals", () => {
    expect(formatInertia(0.00666667)).toBe("0.0067 kg·m²");
    expect(formatInertia(2.5)).toBe("2.5000 kg·m²");
  });

  it("honors custom decimal places and trimming", () => {
    expect(formatInertia(2.5, "kg·m²", { decimals: 2 })).toBe("2.50 kg·m²");
    expect(formatInertia(2.5, "kg·m²", { trimTrailingZeros: true })).toBe("2.5 kg·m²");
  });

  it("supports suppressing the unit suffix", () => {
    expect(formatInertia(1.23456, "kg·m²", { includeUnit: false, decimals: 3 })).toBe("1.235");
  });

  it("handles undefined, null and non-finite gracefully", () => {
    expect(formatInertia(undefined)).toBe("-");
    expect(formatInertia(null)).toBe("-");
    expect(formatInertia(NaN)).toBe("-");
  });
});
