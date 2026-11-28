import type {
  PidConfig,
  PidLimits,
  PidState,
  PidStepResult,
  PidTermBreakdown,
  PidUpdateInput,
} from "../types/control.types";

const EPSILON = 1e-12;

const ZERO_TERMS: PidTermBreakdown = Object.freeze({
  proportional: 0,
  integral: 0,
  derivative: 0,
  rawDerivative: 0,
  unsaturatedOutput: 0,
});

function cleanZero(value: number): number {
  return Object.is(value, -0) || Math.abs(value) < EPSILON ? 0 : value;
}

function clampToLimits(value: number, limits?: PidLimits): number {
  if (!limits) return value;
  if (value > limits.max) return limits.max;
  if (value < limits.min) return limits.min;
  return value;
}

function isValidLimits(limits: PidLimits | undefined, name: string, errors: string[]): void {
  if (!limits) return;
  if (
    typeof limits.min !== "number" ||
    typeof limits.max !== "number" ||
    !Number.isFinite(limits.min) ||
    !Number.isFinite(limits.max)
  ) {
    errors.push(`${name} min and max must be finite numbers.`);
    return;
  }
  if (limits.min > limits.max) {
    errors.push(`${name}.min (${limits.min}) must be <= ${name}.max (${limits.max}).`);
  }
}

export function validatePidConfig(config: PidConfig | null | undefined): {
  readonly isValid: boolean;
  readonly errors: readonly string[];
} {
  if (!config || typeof config !== "object") {
    return {
      isValid: false,
      errors: ["PID configuration object is missing."],
    };
  }

  const errors: string[] = [];

  for (const [key, val] of [
    ["kp", config.kp],
    ["ki", config.ki],
    ["kd", config.kd],
  ] as const) {
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
      errors.push(`PID gain "${key}" must be a non-negative finite number (received ${String(val)}).`);
    }
  }

  isValidLimits(config.outputLimits, "outputLimits", errors);
  isValidLimits(config.integralLimits, "integralLimits", errors);

  if (config.derivativeFilterTimeConstantSeconds !== undefined) {
    const tau = config.derivativeFilterTimeConstantSeconds;
    if (typeof tau !== "number" || !Number.isFinite(tau) || tau < 0) {
      errors.push(
        `derivativeFilterTimeConstantSeconds must be a non-negative finite number (received ${String(tau)}).`
      );
    }
  }

  if (config.derivativeFilterAlpha !== undefined) {
    const alpha = config.derivativeFilterAlpha;
    if (
      typeof alpha !== "number" ||
      !Number.isFinite(alpha) ||
      alpha <= 0 ||
      alpha > 1
    ) {
      errors.push(
        `derivativeFilterAlpha must be a finite number in (0, 1] (received ${String(alpha)}).`
      );
    }
  }

  if (
    config.derivativeMode !== undefined &&
    config.derivativeMode !== "measurement" &&
    config.derivativeMode !== "error"
  ) {
    errors.push(
      `Unsupported derivativeMode "${String(config.derivativeMode)}"; expected "measurement" or "error".`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function createInitialPidState(
  config: PidConfig | null | undefined
): PidState {
  const validation = validatePidConfig(config);
  return {
    isConfigValid: validation.isValid,
    hasPreviousSample: false,
    previousSetpoint: 0,
    previousMeasurement: null,
    previousError: 0,
    integralTerm: 0,
    filteredDerivativeTerm: 0,
    lastOutput: 0,
    lastTerms: ZERO_TERMS,
    lastDtSeconds: 0,
    saturated: false,
    antiWindupActive: false,
    updateCount: 0,
    warnings: [],
    errors: validation.errors,
  };
}

function resolveDerivativeFilterAlpha(
  config: PidConfig,
  dtSeconds: number
): number {
  if (config.derivativeFilterTimeConstantSeconds !== undefined) {
    const tau = config.derivativeFilterTimeConstantSeconds;
    if (tau <= 0) return 1;
    return dtSeconds / (tau + dtSeconds);
  }
  if (config.derivativeFilterAlpha !== undefined) {
    return config.derivativeFilterAlpha;
  }
  return 1;
}

function makeRejectedResult(params: {
  readonly state: PidState;
  readonly isConfigValid: boolean;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}): PidStepResult {
  const nextState: PidState = {
    ...params.state,
    isConfigValid: params.isConfigValid,
    lastOutput: 0,
    lastTerms: params.isConfigValid ? params.state.lastTerms : ZERO_TERMS,
    saturated: false,
    antiWindupActive: false,
    warnings: params.warnings,
    errors: params.errors,
  };
  return {
    accepted: false,
    output: 0,
    error: 0,
    saturated: false,
    antiWindupActive: false,
    terms: ZERO_TERMS,
    state: nextState,
    warnings: params.warnings,
  };
}

/**
 * Executes one pure deterministic PID controller step using explicit timestep `dtSeconds`.
 *
 * Update formulation:
 *   e = setpoint - measurement (or explicit error)
 *   P = kp * e
 *   D_raw = derivative-on-measurement (-kd * (y - y_prev) / dt) by default,
 *           or derivative-on-error (kd * (e - e_prev) / dt) for error-only inputs
 *   D = D_prev + alpha * (D_raw - D_prev)
 *   I_candidate = clamp(I_prev + ki * e * dt, integralLimits)
 *   Conditional anti-windup freezes integration when saturated output pushes in the same sign as e.
 */
export function stepPidController(
  config: PidConfig | null | undefined,
  state: PidState,
  input: PidUpdateInput
): PidStepResult {
  const validation = validatePidConfig(config);
  if (!validation.isValid || !config) {
    return makeRejectedResult({
      state,
      isConfigValid: false,
      warnings: validation.errors,
      errors: validation.errors,
    });
  }

  const dt = input.dtSeconds;
  if (typeof dt !== "number" || !Number.isFinite(dt) || dt <= 0) {
    return makeRejectedResult({
      state,
      isConfigValid: true,
      warnings: [
        `Invalid PID timestep (${String(dt)}); dtSeconds must be finite and > 0.`,
      ],
      errors: [],
    });
  }

  const isSetpointMode = "setpoint" in input;
  let error: number;
  let nextSetpoint = 0;
  let nextMeasurement: number | null;

  if (isSetpointMode) {
    if (
      typeof input.setpoint !== "number" ||
      typeof input.measurement !== "number" ||
      !Number.isFinite(input.setpoint) ||
      !Number.isFinite(input.measurement)
    ) {
      return makeRejectedResult({
        state,
        isConfigValid: true,
        warnings: [
          "Non-finite setpoint or measurement rejected; PID output safely set to 0.",
        ],
        errors: [],
      });
    }
    nextSetpoint = input.setpoint;
    nextMeasurement = input.measurement;
    error = input.setpoint - input.measurement;
  } else {
    if (
      typeof input.error !== "number" ||
      !Number.isFinite(input.error) ||
      (input.measurement !== undefined &&
        (typeof input.measurement !== "number" ||
          !Number.isFinite(input.measurement)))
    ) {
      return makeRejectedResult({
        state,
        isConfigValid: true,
        warnings: [
          "Non-finite PID error input rejected; PID output safely set to 0.",
        ],
        errors: [],
      });
    }
    error = input.error;
    nextMeasurement = input.measurement ?? null;
  }

  const warnings: string[] = [];
  const proportional = cleanZero(config.kp * error);

  // Derivative term calculation (derivative-on-measurement when measurement available and enabled)
  const useMeasurementDerivative =
    (config.derivativeMode ?? "measurement") === "measurement" &&
    nextMeasurement !== null &&
    state.previousMeasurement !== null;
  const useErrorDerivative =
    !useMeasurementDerivative &&
    state.hasPreviousSample &&
    ((config.derivativeMode ?? "measurement") === "error" || !isSetpointMode);

  let rawDerivative = 0;
  if (state.hasPreviousSample && config.kd > 0) {
    if (useMeasurementDerivative && nextMeasurement !== null && state.previousMeasurement !== null) {
      rawDerivative = cleanZero(
        -config.kd * ((nextMeasurement - state.previousMeasurement) / dt)
      );
    } else if (useErrorDerivative) {
      rawDerivative = cleanZero(config.kd * ((error - state.previousError) / dt));
    }
  }

  const alpha = resolveDerivativeFilterAlpha(config, dt);
  const derivative = cleanZero(
    state.hasPreviousSample
      ? state.filteredDerivativeTerm + alpha * (rawDerivative - state.filteredDerivativeTerm)
      : rawDerivative
  );

  // Integral calculation with integral limits and conditional integration anti-windup
  const clampedPrevIntegral = clampToLimits(state.integralTerm, config.integralLimits);
  const deltaIntegral = config.ki * error * dt;
  const candidateIntegral = clampToLimits(
    clampedPrevIntegral + deltaIntegral,
    config.integralLimits
  );

  const candidateUnsaturated = proportional + candidateIntegral + derivative;
  const limits = config.outputLimits;
  const hitsUpperAndWindingUp =
    limits !== undefined && candidateUnsaturated > limits.max && error > 0;
  const hitsLowerAndWindingDown =
    limits !== undefined && candidateUnsaturated < limits.min && error < 0;

  const antiWindupActive =
    config.ki > 0 && (hitsUpperAndWindingUp || hitsLowerAndWindingDown);

  const integral = cleanZero(antiWindupActive ? clampedPrevIntegral : candidateIntegral);
  const unsaturatedOutput = cleanZero(proportional + integral + derivative);
  const output = cleanZero(clampToLimits(unsaturatedOutput, limits));
  const saturated =
    limits !== undefined && Math.abs(output - unsaturatedOutput) > EPSILON;

  const terms: PidTermBreakdown = {
    proportional,
    integral,
    derivative,
    rawDerivative,
    unsaturatedOutput,
  };

  const nextState: PidState = {
    isConfigValid: true,
    hasPreviousSample: true,
    previousSetpoint: nextSetpoint,
    previousMeasurement: nextMeasurement,
    previousError: error,
    integralTerm: integral,
    filteredDerivativeTerm: derivative,
    lastOutput: output,
    lastTerms: terms,
    lastDtSeconds: dt,
    saturated,
    antiWindupActive,
    updateCount: state.updateCount + 1,
    warnings,
    errors: [],
  };

  return {
    accepted: true,
    output,
    error: cleanZero(error),
    saturated,
    antiWindupActive,
    terms,
    state: nextState,
    warnings,
  };
}

/**
 * Reusable stateful PID controller instance with completely isolated internal state
 * suitable for velocity, heading, distance, or position loops.
 */
export class PidController {
  private readonly config: PidConfig;
  private state: PidState;

  constructor(config: PidConfig) {
    this.config = config;
    this.state = createInitialPidState(config);
  }

  getConfig(): PidConfig {
    return this.config;
  }

  getState(): PidState {
    return this.state;
  }

  isValid(): boolean {
    return this.state.isConfigValid;
  }

  update(
    setpoint: number,
    measurement: number,
    dtSeconds: number
  ): PidStepResult {
    const res = stepPidController(this.config, this.state, {
      setpoint,
      measurement,
      dtSeconds,
    });
    this.state = res.state;
    return res;
  }

  updateFromError(
    error: number,
    dtSeconds: number,
    measurement?: number
  ): PidStepResult {
    const res = stepPidController(this.config, this.state, {
      error,
      dtSeconds,
      ...(measurement !== undefined ? { measurement } : {}),
    });
    this.state = res.state;
    return res;
  }

  reset(): PidState {
    this.state = createInitialPidState(this.config);
    return this.state;
  }
}
