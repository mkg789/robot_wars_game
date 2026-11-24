import { describe, expect, it } from "vitest";
import type {
  GroundSurface,
  SimulationRobotConfig,
} from "../types/simulation.types";
import {
  createInitialSimulationState,
  stepDrivetrainDynamics,
} from "./drivetrainDynamics";
import {
  advanceSimulation,
  createInitialRunnerState,
} from "./simulationRunner";
import {
  assertValidGroundSurface,
  DEFAULT_GROUND_SURFACE,
  getGroundSurfacePreset,
  GROUND_SURFACE_PRESETS,
  isGroundSurface,
  REFERENCE_BASELINE_FRICTION_COEFF,
  REFERENCE_BASELINE_KINETIC_FRICTION_COEFF,
  resolveEffectiveFriction,
  resolveEffectiveKineticFriction,
  resolveEffectiveStaticFriction,
  resolveGroundSurface,
  SURFACE_PRESETS,
  validateGroundSurface,
} from "./surfaceModel";

describe("Phase 4.1.1: Ground Surface Model Foundation", () => {
  describe("1. Surface Preset Catalogue", () => {
    it("contains all required preset surfaces with correct IDs", () => {
      const expectedKeys = [
        "steel",
        "concrete",
        "asphalt",
        "wood",
        "rubber-high-grip",
        "low-grip",
      ] as const;

      for (const key of expectedKeys) {
        expect(SURFACE_PRESETS).toHaveProperty(key);
        expect(SURFACE_PRESETS[key].id).toBe(key);
      }
    });

    it("GROUND_SURFACE_PRESETS contains all 6 presets and matches SURFACE_PRESETS", () => {
      expect(GROUND_SURFACE_PRESETS).toHaveLength(6);
      for (const preset of GROUND_SURFACE_PRESETS) {
        expect(SURFACE_PRESETS[preset.id as keyof typeof SURFACE_PRESETS]).toBe(
          preset
        );
      }
    });

    it("all presets have valid, non-empty metadata and provenance documentation", () => {
      for (const preset of GROUND_SURFACE_PRESETS) {
        expect(preset.name.trim().length).toBeGreaterThan(0);
        expect(preset.description.trim().length).toBeGreaterThan(0);
        expect(preset.provenance).toBeDefined();
        expect(preset.provenance?.source).toBe("assumed-simulation-preset");
        expect(preset.provenance?.verified).toBe(false);
        expect(typeof preset.provenance?.notes).toBe("string");
      }
    });

    it("all presets have physically plausible static and kinetic friction coefficients (μk <= μs)", () => {
      for (const preset of GROUND_SURFACE_PRESETS) {
        expect(preset.staticFrictionCoeff).toBeGreaterThan(0);
        expect(preset.kineticFrictionCoeff).toBeGreaterThan(0);
        expect(preset.kineticFrictionCoeff).toBeLessThanOrEqual(
          preset.staticFrictionCoeff
        );
      }
    });

    it("verifies specific nominal values for all 6 presets", () => {
      // Steel: baseline nominal rubber-on-steel
      expect(SURFACE_PRESETS.steel.staticFrictionCoeff).toBe(0.85);
      expect(SURFACE_PRESETS.steel.kineticFrictionCoeff).toBe(0.7);

      // Concrete: smooth finished dry concrete
      expect(SURFACE_PRESETS.concrete.staticFrictionCoeff).toBe(0.9);
      expect(SURFACE_PRESETS.concrete.kineticFrictionCoeff).toBe(0.75);

      // Asphalt: clean dry asphalt pavement
      expect(SURFACE_PRESETS.asphalt.staticFrictionCoeff).toBe(0.95);
      expect(SURFACE_PRESETS.asphalt.kineticFrictionCoeff).toBe(0.8);

      // Wood: smooth dry plywood / hardwood arena
      expect(SURFACE_PRESETS.wood.staticFrictionCoeff).toBe(0.7);
      expect(SURFACE_PRESETS.wood.kineticFrictionCoeff).toBe(0.55);

      // High-grip rubber: textured elastomer matting
      expect(SURFACE_PRESETS["rubber-high-grip"].staticFrictionCoeff).toBe(
        1.15
      );
      expect(SURFACE_PRESETS["rubber-high-grip"].kineticFrictionCoeff).toBe(
        0.95
      );

      // Low-grip: simulated ice / oil spill hazard
      expect(SURFACE_PRESETS["low-grip"].staticFrictionCoeff).toBe(0.2);
      expect(SURFACE_PRESETS["low-grip"].kineticFrictionCoeff).toBe(0.15);
    });

    it("every catalogue preset passes validateGroundSurface with zero errors", () => {
      for (const preset of GROUND_SURFACE_PRESETS) {
        const validation = validateGroundSurface(preset);
        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);
      }
    });
  });

  describe("2. Surface Validation & Invariants", () => {
    it("accepts a valid custom ground surface definition", () => {
      const customSurface: GroundSurface = {
        id: "custom-arena-tile",
        name: "Custom Polycarbonate Tile",
        description: "Smooth polycarbonate floor panels.",
        staticFrictionCoeff: 0.65,
        kineticFrictionCoeff: 0.5,
        provenance: {
          source: "user-specified",
          verified: true,
          notes: "Bench-tested with 60A durometer polyurethane wheel.",
        },
      };

      const res = validateGroundSurface(customSurface);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(isGroundSurface(customSurface)).toBe(true);
      expect(() => assertValidGroundSurface(customSurface)).not.toThrow();
    });

    it("rejects non-object and null definitions", () => {
      expect(validateGroundSurface(null).isValid).toBe(false);
      expect(validateGroundSurface(undefined).isValid).toBe(false);
      expect(validateGroundSurface("steel").isValid).toBe(false);
      expect(validateGroundSurface(123).isValid).toBe(false);
    });

    it("rejects empty or whitespace-only id and name", () => {
      const badId = {
        id: "   ",
        name: "Valid Name",
        description: "Valid Description",
        staticFrictionCoeff: 0.8,
        kineticFrictionCoeff: 0.6,
      };
      expect(validateGroundSurface(badId).isValid).toBe(false);

      const badName = {
        id: "valid-id",
        name: "",
        description: "Valid Description",
        staticFrictionCoeff: 0.8,
        kineticFrictionCoeff: 0.6,
      };
      expect(validateGroundSurface(badName).isValid).toBe(false);
    });

    it("rejects negative or non-finite static friction coefficients", () => {
      const negativeMu = {
        id: "test",
        name: "Test",
        description: "Test",
        staticFrictionCoeff: -0.5,
        kineticFrictionCoeff: 0.3,
      };
      expect(validateGroundSurface(negativeMu).isValid).toBe(false);

      const nanMu = {
        id: "test",
        name: "Test",
        description: "Test",
        staticFrictionCoeff: Number.NaN,
        kineticFrictionCoeff: 0.3,
      };
      expect(validateGroundSurface(nanMu).isValid).toBe(false);

      const infMu = {
        id: "test",
        name: "Test",
        description: "Test",
        staticFrictionCoeff: Number.POSITIVE_INFINITY,
        kineticFrictionCoeff: 0.3,
      };
      expect(validateGroundSurface(infMu).isValid).toBe(false);
    });

    it("rejects negative or non-finite kinetic friction coefficients", () => {
      const negativeK = {
        id: "test",
        name: "Test",
        description: "Test",
        staticFrictionCoeff: 0.8,
        kineticFrictionCoeff: -0.1,
      };
      expect(validateGroundSurface(negativeK).isValid).toBe(false);

      const nanK = {
        id: "test",
        name: "Test",
        description: "Test",
        staticFrictionCoeff: 0.8,
        kineticFrictionCoeff: Number.NaN,
      };
      expect(validateGroundSurface(nanK).isValid).toBe(false);
    });

    it("rejects kinetic friction exceeding static friction (μk > μs)", () => {
      const unphysical = {
        id: "unphysical",
        name: "Unphysical Surface",
        description: "Surface where kinetic friction exceeds static friction.",
        staticFrictionCoeff: 0.5,
        kineticFrictionCoeff: 0.8,
      };

      const res = validateGroundSurface(unphysical);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain(
        "Kinetic friction coefficient (μk = 0.8) cannot exceed static friction coefficient (μs = 0.5)"
      );
      expect(() => assertValidGroundSurface(unphysical)).toThrow(
        /cannot exceed static friction/
      );
    });

    it("permits frictionless surface (μs = 0, μk = 0) and equal coefficients (μs = μk)", () => {
      const zeroFriction = {
        id: "ideal-ice",
        name: "Ideal Frictionless Surface",
        description: "Theoretical zero-friction plane.",
        staticFrictionCoeff: 0,
        kineticFrictionCoeff: 0,
      };
      expect(validateGroundSurface(zeroFriction).isValid).toBe(true);

      const equalCoeff = {
        id: "equal-coulomb",
        name: "Uniform Coulomb Contact",
        description: "Equal static and dynamic friction.",
        staticFrictionCoeff: 0.6,
        kineticFrictionCoeff: 0.6,
      };
      expect(validateGroundSurface(equalCoeff).isValid).toBe(true);
    });
  });

  describe("3. Default Surface & Resolvers", () => {
    it("DEFAULT_GROUND_SURFACE is Steel with static friction 0.85", () => {
      expect(DEFAULT_GROUND_SURFACE).toBe(SURFACE_PRESETS.steel);
      expect(DEFAULT_GROUND_SURFACE.staticFrictionCoeff).toBe(0.85);
      expect(DEFAULT_GROUND_SURFACE.kineticFrictionCoeff).toBe(0.7);
      expect(REFERENCE_BASELINE_FRICTION_COEFF).toBe(0.85);
      expect(REFERENCE_BASELINE_KINETIC_FRICTION_COEFF).toBe(0.7);
    });

    it("getGroundSurfacePreset returns preset by ID and undefined for unknown ID", () => {
      expect(getGroundSurfacePreset("steel")).toBe(SURFACE_PRESETS.steel);
      expect(getGroundSurfacePreset("concrete")).toBe(SURFACE_PRESETS.concrete);
      expect(getGroundSurfacePreset("unknown-surface")).toBeUndefined();
    });

    it("resolveGroundSurface returns DEFAULT_GROUND_SURFACE when input is omitted or undefined", () => {
      expect(resolveGroundSurface()).toBe(DEFAULT_GROUND_SURFACE);
      expect(resolveGroundSurface(undefined)).toBe(DEFAULT_GROUND_SURFACE);
    });

    it("resolveGroundSurface resolves preset by ID string", () => {
      expect(resolveGroundSurface("asphalt")).toBe(SURFACE_PRESETS.asphalt);
      expect(resolveGroundSurface("wood")).toBe(SURFACE_PRESETS.wood);
    });

    it("resolveGroundSurface throws on unknown preset ID string with helpful listing", () => {
      expect(() => resolveGroundSurface("ice-rink")).toThrow(
        /Unknown ground surface preset ID: "ice-rink"/
      );
    });

    it("resolveGroundSurface accepts and validates custom GroundSurface object", () => {
      const custom: GroundSurface = {
        id: "custom-mat",
        name: "Custom Mat",
        description: "Rubber mat",
        staticFrictionCoeff: 1.0,
        kineticFrictionCoeff: 0.8,
      };
      expect(resolveGroundSurface(custom)).toBe(custom);
    });
  });

  describe("4. Effective Friction Compatibility & Scaling", () => {
    it("preserves exact wheel friction when driving on DEFAULT_GROUND_SURFACE (steel, μs = 0.85)", () => {
      // If wheel specifies 0.9 on standard arena floor, on standard arena floor it is strictly 0.9
      expect(resolveEffectiveStaticFriction(0.9, DEFAULT_GROUND_SURFACE)).toBe(
        0.9
      );
      expect(resolveEffectiveStaticFriction(0.85, DEFAULT_GROUND_SURFACE)).toBe(
        0.85
      );
      expect(resolveEffectiveStaticFriction(0.2, DEFAULT_GROUND_SURFACE)).toBe(
        0.2
      );
    });

    it("uses surface static friction when wheel static friction is unspecified", () => {
      expect(
        resolveEffectiveStaticFriction(undefined, DEFAULT_GROUND_SURFACE)
      ).toBe(0.85);
      expect(
        resolveEffectiveStaticFriction(undefined, SURFACE_PRESETS.concrete)
      ).toBe(0.9);
      expect(
        resolveEffectiveStaticFriction(undefined, SURFACE_PRESETS["low-grip"])
      ).toBe(0.2);
      expect(
        resolveEffectiveStaticFriction(
          undefined,
          SURFACE_PRESETS["rubber-high-grip"]
        )
      ).toBe(1.15);
    });

    it("scales wheel static friction proportionally on non-default surfaces", () => {
      // Wheel rated at 0.9 on 0.85 steel:
      // On low-grip (0.20): 0.9 * (0.20 / 0.85) = 0.9 * 0.235294... = ~0.21176
      const lowGripMu = resolveEffectiveStaticFriction(
        0.9,
        SURFACE_PRESETS["low-grip"]
      );
      expect(lowGripMu).toBeCloseTo(0.9 * (0.2 / 0.85), 6);

      // On high-grip (1.15): 0.9 * (1.15 / 0.85) = ~1.2176
      const highGripMu = resolveEffectiveStaticFriction(
        0.9,
        SURFACE_PRESETS["rubber-high-grip"]
      );
      expect(highGripMu).toBeCloseTo(0.9 * (1.15 / 0.85), 6);
    });

    it("returns 0 for non-positive or non-finite wheel or surface friction", () => {
      expect(resolveEffectiveStaticFriction(-0.5, DEFAULT_GROUND_SURFACE)).toBe(
        0
      );
      expect(
        resolveEffectiveStaticFriction(Number.NaN, DEFAULT_GROUND_SURFACE)
      ).toBe(0);

      const zeroSurface: GroundSurface = {
        id: "zero",
        name: "Zero",
        description: "Zero",
        staticFrictionCoeff: 0,
        kineticFrictionCoeff: 0,
      };
      expect(resolveEffectiveStaticFriction(0.85, zeroSurface)).toBe(0);
    });

    it("resolveEffectiveKineticFriction scales kinetic friction properly and handles fallbacks", () => {
      // Default baseline surface with specified wheel kinetic friction
      expect(
        resolveEffectiveKineticFriction(0.75, DEFAULT_GROUND_SURFACE)
      ).toBe(0.75);

      // Unspecified wheel kinetic friction falls back to surface kinetic friction
      expect(
        resolveEffectiveKineticFriction(undefined, DEFAULT_GROUND_SURFACE)
      ).toBe(0.7);
      expect(
        resolveEffectiveKineticFriction(undefined, SURFACE_PRESETS.asphalt)
      ).toBe(0.8);
      expect(
        resolveEffectiveKineticFriction(undefined, SURFACE_PRESETS["low-grip"])
      ).toBe(0.15);

      // Scaled kinetic friction on non-default surface
      const scaledK = resolveEffectiveKineticFriction(
        0.75,
        SURFACE_PRESETS.asphalt
      );
      expect(scaledK).toBeCloseTo(0.75 * (0.8 / 0.7), 6);

      // Zero or invalid values
      expect(
        resolveEffectiveKineticFriction(-0.2, DEFAULT_GROUND_SURFACE)
      ).toBe(0);
      expect(
        resolveEffectiveKineticFriction(Number.NaN, DEFAULT_GROUND_SURFACE)
      ).toBe(0);
    });

    it("resolveEffectiveFriction resolves both static and kinetic friction and clamps μk <= μs", () => {
      const resBaseline = resolveEffectiveFriction(
        { staticFrictionCoeff: 0.9, dynamicFrictionCoeff: 0.75 },
        DEFAULT_GROUND_SURFACE
      );
      expect(resBaseline.staticFrictionCoeff).toBe(0.9);
      expect(resBaseline.kineticFrictionCoeff).toBeCloseTo(
        0.75 * (0.7 / REFERENCE_BASELINE_KINETIC_FRICTION_COEFF),
        6
      );

      // Unspecified wheel dynamic friction falls back to surface kinetic friction
      const resDefault = resolveEffectiveFriction(
        undefined,
        SURFACE_PRESETS.asphalt
      );
      expect(resDefault.staticFrictionCoeff).toBe(0.95);
      expect(resDefault.kineticFrictionCoeff).toBe(0.8);
    });
  });

  describe("5. Simulation Integration & Preservation of Existing Behavior", () => {
    const testConfig: SimulationRobotConfig = {
      totalMassKg: 10.0,
      centerOfMass: { x: 0, y: 0.05, z: 0 },
      yawInertiaKgM2: 0.25,
      trackWidthM: 0.3,
      wheelbaseM: null,
      drivetrain: {
        type: "differential-2",
        drivenWheelCount: 2,
        leftSlotCount: 1,
        rightSlotCount: 1,
      },
      motors: [
        {
          motorId: "m-left",
          name: "Left Motor",
          side: "left",
          slotIndex: 0,
          stallTorqueNm: 2.0,
          noLoadRpm: 1000,
          noLoadAngularVelocityRadPerSec: (1000 * 2 * Math.PI) / 60,
          nominalVoltageV: 12.0,
          provenance: { source: "test", verified: true },
        },
        {
          motorId: "m-right",
          name: "Right Motor",
          side: "right",
          slotIndex: 0,
          stallTorqueNm: 2.0,
          noLoadRpm: 1000,
          noLoadAngularVelocityRadPerSec: (1000 * 2 * Math.PI) / 60,
          nominalVoltageV: 12.0,
          provenance: { source: "test", verified: true },
        },
      ],
      wheels: [
        {
          wheelId: "w-left",
          name: "Left Wheel",
          side: "left",
          slotIndex: 0,
          diameterM: 0.1,
          radiusM: 0.05,
          staticFrictionCoeff: 0.85,
          normalLoadN: 49.03325,
          provenance: { source: "test", verified: true },
        },
        {
          wheelId: "w-right",
          name: "Right Wheel",
          side: "right",
          slotIndex: 0,
          diameterM: 0.1,
          radiusM: 0.05,
          staticFrictionCoeff: 0.85,
          normalLoadN: 49.03325,
          provenance: { source: "test", verified: true },
        },
      ],
      battery: {
        batteryId: "bat-1",
        name: "Test 3S LiPo",
        nominalVoltageV: 12.0,
        fullyChargedVoltageV: 12.6,
        cutoffVoltageV: 9.6,
        provenance: { source: "test", verified: true },
      },
      normalLoads: {
        totalNormalForceN: 98.0665,
        leftSideNormalForceN: 49.03325,
        rightSideNormalForceN: 49.03325,
        perWheelLoads: [
          { wheelId: "w-left", normalForceN: 49.03325, isDriven: true },
          { wheelId: "w-right", normalForceN: 49.03325, isDriven: true },
        ],
      },
      assumptions: [],
      validity: "valid",
      warnings: [],
    };

    it("stepDrivetrainDynamics yields identical results with or without explicit DEFAULT_GROUND_SURFACE", () => {
      const state0 = createInitialSimulationState({ x: 0, z: 0, heading: 0 });
      const dt = 1 / 120;
      const input = { leftThrottle: 1.0, rightThrottle: 1.0 };

      // Step without surface parameter (default fallback)
      const resWithout = stepDrivetrainDynamics(
        testConfig,
        state0,
        input,
        dt,
        12.0,
        10.0
      );

      // Step with explicit DEFAULT_GROUND_SURFACE
      const resWith = stepDrivetrainDynamics(
        testConfig,
        state0,
        input,
        dt,
        12.0,
        10.0,
        DEFAULT_GROUND_SURFACE
      );

      // State equality to machine precision
      expect(resWithout.state.xMeters).toBe(resWith.state.xMeters);
      expect(resWithout.state.longitudinalVelocityMps).toBe(
        resWith.state.longitudinalVelocityMps
      );
      expect(resWithout.state.longitudinalAccelerationMps2).toBe(
        resWith.state.longitudinalAccelerationMps2
      );
      expect(resWithout.state.netDriveForceN).toBe(resWith.state.netDriveForceN);

      // Diagnostics equality
      expect(resWithout.diagnostics.leftDriveForceN).toBe(
        resWith.diagnostics.leftDriveForceN
      );
      expect(resWithout.diagnostics.rightDriveForceN).toBe(
        resWith.diagnostics.rightDriveForceN
      );
      expect(resWithout.diagnostics.wheels[0].tractionLimitN).toBe(
        resWith.diagnostics.wheels[0].tractionLimitN
      );
    });

    it("low-grip surface reduces traction limit and induces wheel slip earlier", () => {
      const state0 = createInitialSimulationState({ x: 0, z: 0, heading: 0 });
      const dt = 1 / 120;
      const input = { leftThrottle: 1.0, rightThrottle: 1.0 };

      // Normal drive on steel (μs = 0.85): traction limit = 0.85 * 49.03325 = 41.678 N
      const resSteel = stepDrivetrainDynamics(
        testConfig,
        state0,
        input,
        dt,
        12.0,
        10.0,
        SURFACE_PRESETS.steel
      );

      // Drive on low-grip ice (μs = 0.20): traction limit = 0.20 * 49.03325 = 9.80665 N
      const resLowGrip = stepDrivetrainDynamics(
        testConfig,
        state0,
        input,
        dt,
        12.0,
        10.0,
        SURFACE_PRESETS["low-grip"]
      );

      const tractionSteel = resSteel.diagnostics.wheels[0].tractionLimitN;
      const tractionIce = resLowGrip.diagnostics.wheels[0].tractionLimitN;

      expect(tractionIce).toBeLessThan(tractionSteel);
      expect(tractionIce).toBeCloseTo(0.2 * 49.03325, 4);

      // On low-grip surface, net drive force is capped by the low traction limit
      expect(resLowGrip.diagnostics.netLongitudinalForceN).toBeLessThan(
        resSteel.diagnostics.netLongitudinalForceN
      );
      expect(resLowGrip.state.longitudinalAccelerationMps2).toBeLessThan(
        resSteel.state.longitudinalAccelerationMps2
      );
    });

    it("high-grip rubber surface increases traction limit", () => {
      const state0 = createInitialSimulationState({ x: 0, z: 0, heading: 0 });
      const dt = 1 / 120;
      const input = { leftThrottle: 1.0, rightThrottle: 1.0 };

      const resSteel = stepDrivetrainDynamics(
        testConfig,
        state0,
        input,
        dt,
        12.0,
        10.0,
        SURFACE_PRESETS.steel
      );

      const resHighGrip = stepDrivetrainDynamics(
        testConfig,
        state0,
        input,
        dt,
        12.0,
        10.0,
        SURFACE_PRESETS["rubber-high-grip"]
      );

      const tractionSteel = resSteel.diagnostics.wheels[0].tractionLimitN;
      const tractionHighGrip = resHighGrip.diagnostics.wheels[0].tractionLimitN;

      expect(tractionHighGrip).toBeGreaterThan(tractionSteel);
      expect(tractionHighGrip).toBeCloseTo(1.15 * 49.03325, 4);
    });

    it("advanceSimulation propagates environmental surface through SimulationRunnerOptions", () => {
      const runner0 = createInitialRunnerState(testConfig);
      const input = { leftThrottle: 1.0, rightThrottle: 1.0 };
      const duration = 0.1; // 100 ms

      // Advance on default steel surface
      const advDefault = advanceSimulation(testConfig, runner0, input, duration);

      // Advance on low-grip surface via options
      const advIce = advanceSimulation(testConfig, runner0, input, duration, {
        surface: SURFACE_PRESETS["low-grip"],
      });

      // Both advance same number of steps
      expect(advIce.stepsExecuted).toBe(advDefault.stepsExecuted);

      // The robot on ice gains less speed due to traction saturation
      const speedDefault =
        advDefault.runnerState.simulationState.longitudinalVelocityMps;
      const speedIce =
        advIce.runnerState.simulationState.longitudinalVelocityMps;

      expect(speedIce).toBeLessThan(speedDefault);
      expect(advIce.stepDiagnostics[0].diagnostics.isTractionLimited).toBe(true);
    });
  });
});
