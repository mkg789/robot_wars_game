import { describe, expect, it } from "vitest";
import {
  resolveAssemblyMass,
  resolveComponentMass,
} from "./massResolvers";

describe("massResolvers", () => {
  describe("resolveComponentMass", () => {
    it("prefers canonical massKg over legacy mass", () => {
      const part = {
        id: "part-1",
        name: "Motor",
        massKg: 2.5,
        mass: 1.0,
      };
      const res = resolveComponentMass(part);
      expect(res.isValid).toBe(true);
      expect(res.massKg).toBe(2.5);
      expect(res.rawValue).toBe(2.5);
      expect(res.source).toBe("massKg");
      expect(res.failureReason).toBeUndefined();
    });

    it("falls back to legacy mass when massKg is undefined", () => {
      const part = {
        id: "part-2",
        name: "Legacy Wheel",
        mass: 0.8,
      };
      const res = resolveComponentMass(part);
      expect(res.isValid).toBe(true);
      expect(res.massKg).toBe(0.8);
      expect(res.rawValue).toBe(0.8);
      expect(res.source).toBe("legacy-mass");
    });

    it("falls back to legacy mass when massKg is null", () => {
      const part = {
        id: "part-3",
        name: "Legacy Chassis",
        massKg: null,
        mass: 4.2,
      };
      const res = resolveComponentMass(part);
      expect(res.isValid).toBe(true);
      expect(res.massKg).toBe(4.2);
      expect(res.source).toBe("legacy-mass");
    });

    it("recovers valid legacy mass when massKg is non-positive or non-finite", () => {
      const zeroWithFallback = {
        id: "part-4a",
        name: "Zero MassKg with Fallback",
        massKg: 0,
        mass: 3.0,
      };
      const resZero = resolveComponentMass(zeroWithFallback);
      expect(resZero.isValid).toBe(true);
      expect(resZero.massKg).toBe(3.0);
      expect(resZero.source).toBe("legacy-mass");
      expect(resZero.warning).toContain("recovered valid legacy mass");

      const nanWithFallback = {
        id: "part-4b",
        name: "NaN MassKg with Fallback",
        massKg: NaN,
        mass: 5.5,
      };
      const resNan = resolveComponentMass(nanWithFallback);
      expect(resNan.isValid).toBe(true);
      expect(resNan.massKg).toBe(5.5);
      expect(resNan.source).toBe("legacy-mass");

      const negWithFallback = {
        id: "part-4c",
        name: "Negative MassKg with Fallback",
        massKg: -2.0,
        mass: 1.5,
      };
      const resNeg = resolveComponentMass(negWithFallback);
      expect(resNeg.isValid).toBe(true);
      expect(resNeg.massKg).toBe(1.5);
      expect(resNeg.source).toBe("legacy-mass");
    });

    it("rejects missing mass (both undefined or null)", () => {
      const part = {
        id: "part-5",
        name: "Empty Part",
      };
      const res = resolveComponentMass(part);
      expect(res.isValid).toBe(false);
      expect(res.massKg).toBe(0);
      expect(res.failureReason).toBe("missing");
      expect(res.source).toBe("none");
    });

    it("rejects zero mass when no valid fallback exists", () => {
      const partZero = {
        id: "part-6a",
        name: "Zero Part",
        massKg: 0,
      };
      const resZero = resolveComponentMass(partZero);
      expect(resZero.isValid).toBe(false);
      expect(resZero.massKg).toBe(0);
      expect(resZero.failureReason).toBe("zero");

      const partLegacyZero = {
        id: "part-6b",
        name: "Legacy Zero Part",
        mass: 0,
      };
      const resLegacyZero = resolveComponentMass(partLegacyZero);
      expect(resLegacyZero.isValid).toBe(false);
      expect(resLegacyZero.failureReason).toBe("zero");
    });

    it("rejects negative mass when no valid fallback exists", () => {
      const partNeg = {
        id: "part-7a",
        name: "Negative Part",
        massKg: -3.5,
      };
      const resNeg = resolveComponentMass(partNeg);
      expect(resNeg.isValid).toBe(false);
      expect(resNeg.massKg).toBe(0);
      expect(resNeg.failureReason).toBe("negative");

      const partLegacyNeg = {
        id: "part-7b",
        name: "Legacy Negative Part",
        mass: -1.2,
      };
      const resLegacyNeg = resolveComponentMass(partLegacyNeg);
      expect(resLegacyNeg.isValid).toBe(false);
      expect(resLegacyNeg.failureReason).toBe("negative");
    });

    it("rejects NaN mass when no valid fallback exists", () => {
      const partNan = {
        id: "part-8",
        name: "NaN Part",
        massKg: NaN,
      };
      const res = resolveComponentMass(partNan);
      expect(res.isValid).toBe(false);
      expect(res.massKg).toBe(0);
      expect(res.failureReason).toBe("non-finite");
    });

    it("rejects Infinity and -Infinity mass", () => {
      const partInf = {
        id: "part-9a",
        name: "Inf Part",
        massKg: Infinity,
      };
      const resInf = resolveComponentMass(partInf);
      expect(resInf.isValid).toBe(false);
      expect(resInf.massKg).toBe(0);
      expect(resInf.failureReason).toBe("non-finite");

      const partNegInf = {
        id: "part-9b",
        name: "Neg Inf Part",
        massKg: -Infinity,
      };
      const resNegInf = resolveComponentMass(partNegInf);
      expect(resNegInf.isValid).toBe(false);
      expect(resNegInf.failureReason).toBe("non-finite");
    });
  });

  describe("resolveAssemblyMass", () => {
    it("correctly aggregates total mass and separates valid and invalid components", () => {
      const parts = [
        { id: "p1", name: "Chassis", massKg: 10.0 },
        { id: "p2", name: "Wheel L", mass: 1.5 },
        { id: "p3", name: "Wheel R", massKg: 1.5 },
        { id: "p4", name: "Corrupted Battery", massKg: NaN },
        { id: "p5", name: "Zero Sensor", massKg: 0 },
        { id: "p6", name: "Ghost Part", massKg: undefined },
      ];

      const res = resolveAssemblyMass(parts);
      expect(res.totalMassKg).toBeCloseTo(13.0, 5);
      expect(res.validComponents).toHaveLength(3);
      expect(res.invalidComponents).toHaveLength(3);
      expect(res.warnings).toHaveLength(3);

      expect(res.validComponents.map((c) => c.partId)).toEqual(["p1", "p2", "p3"]);
      expect(res.invalidComponents.map((c) => c.partId)).toEqual(["p4", "p5", "p6"]);
    });

    it("returns totalMassKg = 0 for an empty assembly", () => {
      const res = resolveAssemblyMass([]);
      expect(res.totalMassKg).toBe(0);
      expect(res.validComponents).toHaveLength(0);
      expect(res.invalidComponents).toHaveLength(0);
      expect(res.warnings).toHaveLength(0);
    });
  });
});
