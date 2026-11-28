import { describe, expect, it } from "vitest";
import {
  createInitialPidState,
  PidController,
  stepPidController,
  validatePidConfig,
} from "./pidController";

describe("Phase 9.3: PID Controller Framework", () => {
  it("computes pure P-only, I-only, and D-only responses accurately", () => {
    const pOnly = new PidController({ kp: 2.5, ki: 0, kd: 0 });
    const pRes = pOnly.update(4, 1.5, 0.05);
    expect(pRes.accepted).toBe(true);
    expect(pRes.error).toBeCloseTo(2.5, 10);
    expect(pRes.terms.proportional).toBeCloseTo(6.25, 10);
    expect(pRes.terms.integral).toBe(0);
    expect(pRes.terms.derivative).toBe(0);
    expect(pRes.output).toBeCloseTo(6.25, 10);

    const iOnly = new PidController({ kp: 0, ki: 1.5, kd: 0 });
    const i1 = iOnly.update(2, 0, 0.1);
    const i2 = iOnly.update(2, 0, 0.1);
    const i3 = iOnly.update(2, 0, 0.2);
    expect(i1.output).toBeCloseTo(0.3, 10);
    expect(i2.output).toBeCloseTo(0.6, 10);
    expect(i3.output).toBeCloseTo(1.2, 10);
    expect(i3.terms.integral).toBeCloseTo(1.2, 10);

    // D-only with derivative-on-measurement: first step zero derivative, second step -kd * dy/dt
    const dOnly = new PidController({ kp: 0, ki: 0, kd: 0.5 });
    const d1 = dOnly.update(10, 0, 0.1);
    const d2 = dOnly.update(10, 2, 0.1);
    expect(d1.output).toBe(0);
    expect(d2.output).toBeCloseTo(-0.5 * ((2 - 0) / 0.1), 10);
  });

  it("combines P, I, and D terms cleanly and tracks setpoints smoothly across closed-loop steps", () => {
    const pid = new PidController({
      kp: 1.8,
      ki: 1.5,
      kd: 0.15,
      outputLimits: { min: -10, max: 10 },
      integralLimits: { min: -5, max: 5 },
      derivativeFilterTimeConstantSeconds: 0.02,
    });

    // Simulate simple damped first-order plant: y[k+1] = y[k] + (u[k] - 0.5 * y[k]) * dt
    let measurement = 0;
    const dt = 0.02;
    const setpoint = 5.0;
    for (let i = 0; i < 400; i++) {
      const res = pid.update(setpoint, measurement, dt);
      expect(res.accepted).toBe(true);
      measurement += (res.output - 0.5 * measurement) * dt;
    }

    expect(measurement).toBeCloseTo(setpoint, 2);
    expect(Math.abs(pid.getState().previousError)).toBeLessThan(0.01);
  });

  it("scales integral and derivative cleanly across different timestep durations", () => {
    const fast = new PidController({ kp: 0, ki: 2, kd: 0.5, derivativeMode: "error" });
    const slow = new PidController({ kp: 0, ki: 2, kd: 0.5, derivativeMode: "error" });

    fast.updateFromError(1, 0.05);
    slow.updateFromError(1, 0.1);
    const f2 = fast.updateFromError(2, 0.05);
    const s2 = slow.updateFromError(2, 0.1);

    expect(f2.terms.integral).toBeCloseTo(2 * (1 * 0.05 + 2 * 0.05), 10);
    expect(s2.terms.integral).toBeCloseTo(2 * (1 * 0.1 + 2 * 0.1), 10);
    expect(f2.terms.derivative).toBeCloseTo(0.5 * (1 / 0.05), 10);
    expect(s2.terms.derivative).toBeCloseTo(0.5 * (1 / 0.1), 10);
  });

  it("enforces output saturation and integral limits accurately", () => {
    const pid = new PidController({
      kp: 2.0,
      ki: 5.0,
      kd: 0,
      outputLimits: { min: -1.0, max: 1.0 },
      integralLimits: { min: -0.4, max: 0.4 },
    });

    // Upper saturation
    const high = pid.update(5, 0, 0.1);
    expect(high.output).toBe(1.0);
    expect(high.saturated).toBe(true);

    // Lower saturation
    const low = pid.update(-5, 0, 0.1);
    expect(low.output).toBe(-1.0);
    expect(low.saturated).toBe(true);

    // Integral limits clamp integral accumulator cleanly during unsaturated operation
    const boundedI = new PidController({
      kp: 0,
      ki: 10,
      kd: 0,
      integralLimits: { min: -0.3, max: 0.4 },
    });
    for (let i = 0; i < 10; i++) {
      boundedI.update(1, 0, 0.1);
    }
    expect(boundedI.getState().integralTerm).toBeCloseTo(0.4, 10);
    for (let i = 0; i < 20; i++) {
      boundedI.update(-1, 0, 0.1);
    }
    expect(boundedI.getState().integralTerm).toBeCloseTo(-0.3, 10);
  });

  it("prevents integral windup during saturation while still unwinding on reversed error", () => {
    const pid = new PidController({
      kp: 10,
      ki: 5,
      kd: 0,
      outputLimits: { min: -1, max: 1 },
    });

    // Drive far into positive saturation: P = 20 >> 1 -> anti-windup freezes integral at 0
    for (let i = 0; i < 10; i++) {
      const step = pid.update(2, 0, 0.1);
      expect(step.output).toBe(1);
      expect(step.saturated).toBe(true);
      expect(step.antiWindupActive).toBe(true);
      expect(step.terms.integral).toBe(0);
    }

    // Immediate recovery when error drops without integral windup overshoot
    const recover = pid.update(0.05, 0, 0.1);
    expect(recover.saturated).toBe(false);
    expect(recover.antiWindupActive).toBe(false);
    // P = 0.5, I = 5 * 0.05 * 0.1 = 0.025 -> total 0.525
    expect(recover.output).toBeCloseTo(0.525, 10);

    // Build small integral, saturate positive, then reverse error -> allows unwinding downward
    pid.reset();
    pid.update(0.05, 0, 1.0); // unsaturated: I = 0.25
    expect(pid.getState().integralTerm).toBeCloseTo(0.25, 10);
    const rev = pid.updateFromError(-1.0, 0.1); // candidate unsaturated negative saturation with e < 0 triggers lower windup
    expect(rev.output).toBe(-1);
    const gentleRev = pid.updateFromError(-0.02, 0.1);
    expect(gentleRev.terms.integral).toBeLessThan(0.25);
  });

  it("uses derivative-on-measurement by default to eliminate setpoint step derivative kick", () => {
    const measPid = new PidController({
      kp: 1,
      ki: 0,
      kd: 2,
      derivativeMode: "measurement",
    });
    const errPid = new PidController({
      kp: 1,
      ki: 0,
      kd: 2,
      derivativeMode: "error",
    });

    // Initialize both cleanly at setpoint = 1, measurement = 1 (steady state)
    measPid.update(1, 1, 0.1);
    errPid.update(1, 1, 0.1);

    // Instantaneous setpoint jump from 1 -> 6 while measurement remains 1
    const measJump = measPid.update(6, 1, 0.1);
    const errJump = errPid.update(6, 1, 0.1);

    // Derivative-on-measurement produces zero derivative kick on setpoint change
    expect(measJump.terms.derivative).toBe(0);
    expect(measJump.output).toBeCloseTo(5, 10);

    // Derivative-on-error produces large +100 spike (kd * dError/dt = 2 * 5 / 0.1)
    expect(errJump.terms.derivative).toBeCloseTo(100, 10);
    expect(errJump.output).toBeCloseTo(105, 10);

    // Error-based update method supports optional continuous measurement cleanly too
    const headingPid = new PidController({ kp: 1, ki: 0, kd: 0.5 });
    headingPid.updateFromError(0.2, 0.1, 0);
    const nextHeading = headingPid.updateFromError(-0.1, 0.1, 0.3);
    expect(nextHeading.terms.rawDerivative).toBeCloseTo(-1.5, 10);
  });

  it("applies first-order derivative low-pass filtering cleanly across timesteps", () => {
    const unfiltered = new PidController({
      kp: 0,
      ki: 0,
      kd: 1,
    });
    const filteredTau = new PidController({
      kp: 0,
      ki: 0,
      kd: 1,
      derivativeFilterTimeConstantSeconds: 0.09, // alpha = 0.01 / (0.09 + 0.01) = 0.1
    });
    const filteredAlpha = new PidController({
      kp: 0,
      ki: 0,
      kd: 1,
      derivativeFilterAlpha: 0.25,
    });

    unfiltered.update(0, 0, 0.01);
    filteredTau.update(0, 0, 0.01);
    filteredAlpha.update(0, 0, 0.01);

    // Measurement step dy = 0.1 over dt = 0.01 -> raw D = -10
    const uRes = unfiltered.update(0, 0.1, 0.01);
    const tRes = filteredTau.update(0, 0.1, 0.01);
    const aRes = filteredAlpha.update(0, 0.1, 0.01);

    expect(uRes.terms.rawDerivative).toBeCloseTo(-10, 10);
    expect(uRes.output).toBeCloseTo(-10, 10);

    expect(tRes.terms.rawDerivative).toBeCloseTo(-10, 10);
    expect(tRes.output).toBeCloseTo(-1.0, 10);

    expect(aRes.output).toBeCloseTo(-2.5, 10);

    // Second step keeps converging smoothly toward steady raw derivative
    const tRes2 = filteredTau.update(0, 0.2, 0.01);
    expect(tRes2.output).toBeCloseTo(-1.9, 10);
  });

  it("resets integral, derivative filter, and history completely without residual leakage", () => {
    const pid = new PidController({
      kp: 1,
      ki: 2,
      kd: 0.5,
      derivativeFilterTimeConstantSeconds: 0.05,
    });

    pid.update(5, 0, 0.1);
    pid.update(5, 1, 0.1);
    expect(pid.getState().integralTerm).toBeGreaterThan(0);
    expect(pid.getState().filteredDerivativeTerm).not.toBe(0);
    expect(pid.getState().updateCount).toBe(2);

    const resetState = pid.reset();
    expect(resetState.hasPreviousSample).toBe(false);
    expect(resetState.previousMeasurement).toBeNull();
    expect(resetState.integralTerm).toBe(0);
    expect(resetState.filteredDerivativeTerm).toBe(0);
    expect(resetState.lastOutput).toBe(0);
    expect(resetState.updateCount).toBe(0);

    // Post-reset response must match a brand-new controller identically
    const fresh = new PidController(pid.getConfig());
    expect(pid.update(5, 0, 0.1)).toEqual(fresh.update(5, 0, 0.1));
  });

  it("handles invalid configurations, zero/invalid timesteps, and non-finite inputs safely", () => {
    expect(
      validatePidConfig({ kp: -1, ki: 0, kd: 0 }).isValid
    ).toBe(false);
    expect(
      validatePidConfig({
        kp: 1,
        ki: 0,
        kd: 0,
        outputLimits: { min: 2, max: -2 },
      }).isValid
    ).toBe(false);
    expect(
      validatePidConfig({
        kp: 1,
        ki: 0,
        kd: 0,
        derivativeFilterAlpha: 1.5,
      }).isValid
    ).toBe(false);

    const badPid = new PidController({ kp: Number.NaN, ki: 0, kd: 0 });
    expect(badPid.isValid()).toBe(false);
    const badRes = badPid.update(1, 0, 0.02);
    expect(badRes.accepted).toBe(false);
    expect(badRes.output).toBe(0);

    // Valid PID preserves prior integral when rejecting bad dt or non-finite input
    const pid = new PidController({ kp: 1, ki: 2, kd: 0 });
    pid.update(2, 0, 0.5); // P = 2, I = 2
    const savedIntegral = pid.getState().integralTerm;
    expect(savedIntegral).toBeCloseTo(2, 10);

    const zeroDt = pid.update(2, 0, 0);
    expect(zeroDt.accepted).toBe(false);
    expect(zeroDt.output).toBe(0);
    expect(zeroDt.state.integralTerm).toBeCloseTo(savedIntegral, 10);

    const negDt = pid.update(2, 0, -0.05);
    expect(negDt.accepted).toBe(false);
    expect(negDt.output).toBe(0);

    const nanInput = pid.update(Number.POSITIVE_INFINITY, 0, 0.02);
    expect(nanInput.accepted).toBe(false);
    expect(nanInput.output).toBe(0);
    expect(nanInput.state.integralTerm).toBeCloseTo(savedIntegral, 10);
  });

  it("is strictly deterministic and keeps multiple PID instances completely independent", () => {
    const config = {
      kp: 1.4,
      ki: 0.7,
      kd: 0.1,
      outputLimits: { min: -1, max: 1 },
      integralLimits: { min: -0.6, max: 0.6 },
      derivativeFilterTimeConstantSeconds: 0.04,
    };

    const runPureSequence = () => {
      let state = createInitialPidState(config);
      const outputs: number[] = [];
      for (let i = 0; i < 15; i++) {
        const res = stepPidController(config, state, {
          setpoint: 3.0,
          measurement: i * 0.15,
          dtSeconds: 0.02,
        });
        state = res.state;
        outputs.push(res.output);
      }
      return { state, outputs };
    };

    expect(runPureSequence()).toEqual(runPureSequence());

    const leftPid = new PidController(config);
    const rightPid = new PidController(config);

    for (let i = 0; i < 10; i++) {
      leftPid.update(10, i * 0.5, 0.05);
    }
    // Right instance must remain completely untouched by left instance updates
    expect(rightPid.getState().updateCount).toBe(0);
    expect(rightPid.getState().integralTerm).toBe(0);
    const rightFirst = rightPid.update(1, 0, 0.05);
    expect(rightFirst.terms.proportional).toBeCloseTo(1.4, 10);
  });
});
