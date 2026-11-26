import type {
  ElectricalCompatibilityCheck,
  ElectricalCompatibilityResult,
  ElectricalCompatibilityStatus,
  ElectricalComponentSpec,
  ElectricalConnectorSpec,
  ElectricalInterfaceRole,
  ElectricalInterfaceSpec,
  ElectricalPinSpec,
  ElectricalProvenance,
  ElectricalSignalType,
} from "../types/electrical.types";

function isPowerRole(role: ElectricalInterfaceRole): boolean {
  return (
    role === "power-input" ||
    role === "power-output" ||
    role === "power-bidirectional"
  );
}

function isSignalRole(role: ElectricalInterfaceRole): boolean {
  return (
    role === "signal-input" ||
    role === "signal-output" ||
    role === "signal-bidirectional"
  );
}

function combineProvenance(
  a?: ElectricalProvenance,
  b?: ElectricalProvenance
): ElectricalProvenance {
  if (!a || !b || a.method === "unknown" || b.method === "unknown") {
    return {
      method: "unknown",
      notes: "One or more electrical endpoint specifications are unknown or incomplete.",
    };
  }
  if (a.method === "estimated" || b.method === "estimated") {
    return {
      method: "estimated",
      basis: "Evaluated with at least one estimated electrical specification.",
    };
  }
  if (a.method === "user-supplied" || b.method === "user-supplied") {
    return {
      method: "user-supplied",
      notes: "Evaluated from user-supplied electrical metadata.",
    };
  }
  if (a.verified && b.verified) {
    return {
      method: a.method,
      verified: true,
      source: `${a.source}; ${b.source}`,
    };
  }
  return {
    method: "datasheet",
    verified: false,
    source: `${a.source}; ${b.source}`,
    notes: "Derived from unverified catalogue preset specifications.",
  };
}

function evaluatePinCapabilities(
  sourcePin: ElectricalPinSpec,
  targetPin: ElectricalPinSpec,
  requestedSignal?: ElectricalSignalType
): ElectricalCompatibilityCheck {
  if (sourcePin.isGround && targetPin.isGround) {
    return {
      id: "pin-ground-match",
      aspect: "pin-capability",
      status: "pass",
      message: `Ground reference pins (${sourcePin.pinName} -> ${targetPin.pinName}) match.`,
    };
  }
  if (sourcePin.isPower && targetPin.isPower) {
    return {
      id: "pin-power-match",
      aspect: "pin-capability",
      status: "pass",
      message: `Power terminals (${sourcePin.pinName} -> ${targetPin.pinName}) are electrically compatible in role.`,
    };
  }

  if (requestedSignal) {
    const srcSupports =
      sourcePin.signalTypes.includes(requestedSignal) ||
      (requestedSignal === "pwm" && sourcePin.pwmCapable) ||
      (requestedSignal === "analog" && sourcePin.analogCapable) ||
      (requestedSignal === "digital" && sourcePin.digitalCapable);
    const dstSupports =
      targetPin.signalTypes.includes(requestedSignal) ||
      (requestedSignal === "pwm" && targetPin.pwmCapable) ||
      (requestedSignal === "analog" && targetPin.analogCapable) ||
      (requestedSignal === "digital" && targetPin.digitalCapable);

    if (!srcSupports || !dstSupports) {
      return {
        id: "pin-signal-unsupported",
        aspect: "pin-capability",
        status: "error",
        message: `Pin "${!srcSupports ? sourcePin.pinName : targetPin.pinName}" does not support "${requestedSignal}" signalling.`,
        correctiveAction: `Assign a pin supporting "${requestedSignal}" instead of assuming all GPIOs are interchangeable.`,
      };
    }
  }

  const shared = sourcePin.signalTypes.filter((s) => targetPin.signalTypes.includes(s));
  if (
    sourcePin.pinType === "signal" &&
    targetPin.pinType === "signal" &&
    shared.length === 0
  ) {
    return {
      id: "pin-protocol-disjoint",
      aspect: "pin-capability",
      status: "error",
      message: `Signal pin "${sourcePin.pinName}" (${sourcePin.signalTypes.join(",")}) shares no compatible protocol with "${targetPin.pinName}" (${targetPin.signalTypes.join(",")}).`,
      correctiveAction: "Connect compatible signal/protocol pins or add a protocol converter.",
    };
  }

  return {
    id: "pin-capability-ok",
    aspect: "pin-capability",
    status: "pass",
    message: `Pin capabilities compatible (${sourcePin.pinName} -> ${targetPin.pinName}).`,
  };
}

function evaluateConnectorCompatibility(
  srcConn?: ElectricalConnectorSpec | null,
  dstConn?: ElectricalConnectorSpec | null
): ElectricalCompatibilityCheck {
  if (!srcConn || !dstConn) {
    return {
      id: "connector-missing",
      aspect: "connector-physical",
      status: "unknown",
      message: "Connector metadata unavailable for one or both interfaces.",
      provenance: { method: "unknown", notes: "Connector metadata omitted." },
    };
  }
  if (srcConn.connectorType === "unknown" || dstConn.connectorType === "unknown") {
    return {
      id: "connector-unknown",
      aspect: "connector-physical",
      status: "unknown",
      message: `Physical connector (${srcConn.name} -> ${dstConn.name}) is unverified.`,
      provenance: { method: "unknown", notes: "At least one connector type is unknown." },
    };
  }

  const compatible =
    srcConn.connectorType === dstConn.connectorType ||
    srcConn.compatibleConnectorTypes?.includes(dstConn.connectorType) ||
    dstConn.compatibleConnectorTypes?.includes(srcConn.connectorType);

  if (!compatible) {
    return {
      id: "connector-mismatch",
      aspect: "connector-physical",
      status: "warning",
      message: `Physical connector mismatch: "${srcConn.connectorType}" vs "${dstConn.connectorType}".`,
      correctiveAction: "Use a physical harness adapter or matching connector termination.",
      provenance: combineProvenance(srcConn.provenance, dstConn.provenance),
    };
  }

  return {
    id: "connector-match",
    aspect: "connector-physical",
    status: "pass",
    message: `Physical connector family "${srcConn.connectorType}" matches cleanly.`,
    provenance: combineProvenance(srcConn.provenance, dstConn.provenance),
  };
}

/**
 * Evaluates electrical and physical compatibility between two electrical component endpoints
 * without assuming certainty when voltage, current, or pin specifications are missing.
 */
export function evaluateElectricalCompatibility(params: {
  readonly sourceComponent: ElectricalComponentSpec;
  readonly sourceInterface: ElectricalInterfaceSpec;
  readonly sourcePin?: ElectricalPinSpec | null;
  readonly sourceConnector?: ElectricalConnectorSpec | null;
  readonly targetComponent: ElectricalComponentSpec;
  readonly targetInterface: ElectricalInterfaceSpec;
  readonly targetPin?: ElectricalPinSpec | null;
  readonly targetConnector?: ElectricalConnectorSpec | null;
  readonly signalProtocol?: ElectricalSignalType;
}): ElectricalCompatibilityResult {
  const {
    sourceInterface,
    targetInterface,
    sourcePin,
    targetPin,
    sourceConnector,
    targetConnector,
    signalProtocol,
  } = params;

  const checks: ElectricalCompatibilityCheck[] = [];
  const conditionsEvaluated: string[] = [];
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const missingInformation: string[] = [];

  // 1. Interface role compatibility
  conditionsEvaluated.push("interface-role");
  const sRole = sourceInterface.role;
  const tRole = targetInterface.role;

  let roleValid = true;
  if (sRole === "ground" || tRole === "ground") {
    if (sRole !== "ground" || tRole !== "ground") {
      roleValid = false;
      checks.push({
        id: "role-ground-short",
        aspect: "ground-reference",
        status: "error",
        message: `Cannot connect ${sRole} interface "${sourceInterface.name}" directly to ${tRole} "${targetInterface.name}" (short/reference fault).`,
        correctiveAction: "Connect ground interfaces only to ground references and power outputs to power inputs.",
      });
    } else {
      checks.push({
        id: "role-ground-ok",
        aspect: "ground-reference",
        status: "pass",
        message: "Common ground reference connection valid.",
      });
    }
  } else if (isPowerRole(sRole) && isSignalRole(tRole)) {
    roleValid = false;
    checks.push({
      id: "role-power-to-signal",
      aspect: "interface-role",
      status: "error",
      message: `Cannot wire high-power interface "${sourceInterface.name}" directly into signal interface "${targetInterface.name}".`,
      correctiveAction: "Use dedicated power supply pins (VIN/VCC) for power and GPIO pins for signals.",
    });
  } else if (isSignalRole(sRole) && isPowerRole(tRole)) {
    roleValid = false;
    checks.push({
      id: "role-signal-to-power",
      aspect: "interface-role",
      status: "error",
      message: `Signal interface "${sourceInterface.name}" cannot directly power "${targetInterface.name}".`,
      correctiveAction: "Drive power loads through a motor driver, ESC, relay, or power distribution bus.",
    });
  } else if (
    (sRole === "power-output" && tRole === "power-output") ||
    (sRole === "signal-output" && tRole === "signal-output")
  ) {
    roleValid = false;
    checks.push({
      id: "role-output-contention",
      aspect: "signal-direction",
      status: "error",
      message: `Direction contention: both "${sourceInterface.name}" and "${targetInterface.name}" are active ${sRole}s.`,
      correctiveAction: "Connect an output interface to an input or bidirectional interface.",
    });
  } else if (
    (sRole === "power-input" && tRole === "power-input") ||
    (sRole === "signal-input" && tRole === "signal-input")
  ) {
    checks.push({
      id: "role-input-to-input",
      aspect: "signal-direction",
      status: "warning",
      message: `Both "${sourceInterface.name}" and "${targetInterface.name}" are inputs with no active source driver.`,
      correctiveAction: "Connect an output driver/source or specify bidirectional roles if shared bus.",
    });
  } else {
    checks.push({
      id: "role-compatible",
      aspect: "interface-role",
      status: "pass",
      message: `Interface roles (${sRole} -> ${tRole}) match cleanly.`,
    });
  }

  // 2. Voltage compatibility
  const srcPowerRole = params.sourceComponent.driverOrRegulatorSpec?.powerRole;
  const srcIsPassThrough =
    params.sourceComponent.componentType === "switch" ||
    params.sourceComponent.componentType === "pdb" ||
    params.sourceComponent.componentType === "passive" ||
    srcPowerRole === "switch" ||
    srcPowerRole === "fuse" ||
    srcPowerRole === "pdb" ||
    srcPowerRole === "pass-through";

  if (roleValid && sRole !== "ground" && tRole !== "ground") {
    conditionsEvaluated.push("voltage");
    const srcV = sourcePin?.supportedVoltage ?? sourceInterface.voltageSpec;
    const dstV = targetPin?.supportedVoltage ?? targetInterface.voltageSpec;

    const srcMin = srcV?.minV ?? srcV?.nominalV;
    const srcMax = srcV?.maxV ?? srcV?.nominalV;
    const dstMin = dstV?.minV ?? dstV?.nominalV;
    const dstMax = dstV?.maxV ?? dstV?.nominalV;

    if (srcIsPassThrough && sRole === "power-output") {
      checks.push({
        id: "voltage-passthrough-deferred",
        aspect: "voltage",
        status: "pass",
        message:
          "Pass-through branch propagates upstream supply voltage (verified in power-path analysis).",
      });
    } else if (
      srcMax === undefined ||
      srcMin === undefined ||
      dstMax === undefined ||
      dstMin === undefined
    ) {
      missingInformation.push("Operating voltage bounds missing on at least one endpoint.");
      checks.push({
        id: "voltage-unknown",
        aspect: "voltage",
        status: "unknown",
        message: "Voltage compatibility unverified because operating voltage range is missing.",
        correctiveAction: "Populate datasheet or measured voltage specifications for both components.",
      });
    } else if (srcMax > dstMax + 0.05) {
      checks.push({
        id: "voltage-overvoltage",
        aspect: "voltage",
        status: "error",
        message: `Overvoltage hazard: source reaches ${srcMax.toFixed(1)}V, exceeding target max ${dstMax.toFixed(1)}V.`,
        correctiveAction: "Insert a voltage regulator / DC-DC buck converter or select a compatible supply voltage.",
      });
    } else if (srcMin < dstMin - 0.05 && srcMax < dstMin) {
      checks.push({
        id: "voltage-undervoltage",
        aspect: "voltage",
        status: "error",
        message: `Undervoltage mismatch: source max ${srcMax.toFixed(1)}V is below target minimum ${dstMin.toFixed(1)}V.`,
        correctiveAction: "Use a higher-voltage battery/rail or step-up boost regulator.",
      });
    } else if (srcMin < dstMin - 0.05) {
      checks.push({
        id: "voltage-partial-sag",
        aspect: "voltage",
        status: "warning",
        message: `Low-voltage margin: source minimum (${srcMin.toFixed(1)}V) dips below target minimum (${dstMin.toFixed(1)}V).`,
        correctiveAction: "Monitor battery voltage cutoff or use a regulated rail.",
      });
    } else {
      checks.push({
        id: "voltage-ok",
        aspect: "voltage",
        status: "pass",
        message: `Voltage envelope compatible (${srcMin.toFixed(1)}–${srcMax.toFixed(1)}V within ${dstMin.toFixed(1)}–${dstMax.toFixed(1)}V).`,
      });
    }
  }

  // 3. Current limit compatibility (where supply output & load current exist)
  if (roleValid && isPowerRole(sRole) && isPowerRole(tRole)) {
    conditionsEvaluated.push("current");
    const srcCap = sourcePin?.currentLimits ?? sourceInterface.currentSpec;
    const dstDraw = targetPin?.currentLimits ?? targetInterface.currentSpec;
    const srcMaxA = srcCap?.maxContinuousA;
    const dstReqA = dstDraw?.peakOrStallA ?? dstDraw?.maxContinuousA ?? dstDraw?.nominalA;

    if (srcMaxA === undefined || dstReqA === undefined) {
      missingInformation.push("Current limit / load draw unknown on one or both power endpoints.");
      checks.push({
        id: "current-unknown",
        aspect: "current",
        status: "unknown",
        message: "Current capacity margin is unknown due to missing continuous/peak current ratings.",
      });
    } else if (dstReqA > srcMaxA) {
      checks.push({
        id: "current-overload",
        aspect: "current",
        status: "warning",
        message: `Load peak/continuous current (${dstReqA.toFixed(2)}A) exceeds source limit (${srcMaxA.toFixed(2)}A).`,
        correctiveAction: "Route high current through a battery PDB / high-current driver instead of logic rails.",
      });
    } else {
      checks.push({
        id: "current-ok",
        aspect: "current",
        status: "pass",
        message: `Current demand (${dstReqA.toFixed(2)}A) is within supply capability (${srcMaxA.toFixed(2)}A).`,
      });
    }
  }

  // 4. Signal / protocol compatibility
  if (roleValid && (isSignalRole(sRole) || isSignalRole(tRole))) {
    conditionsEvaluated.push("signal-protocol");
    const srcSignals = sourcePin?.signalTypes ?? sourceInterface.supportedSignals ?? [];
    const dstSignals = targetPin?.signalTypes ?? targetInterface.supportedSignals ?? [];

    if (signalProtocol) {
      if (!srcSignals.includes(signalProtocol) || !dstSignals.includes(signalProtocol)) {
        checks.push({
          id: "protocol-unsupported",
          aspect: "signal-protocol",
          status: "error",
          message: `Protocol "${signalProtocol}" not supported on both "${sourceInterface.name}" and "${targetInterface.name}".`,
          correctiveAction: "Select matching protocol pins or add interface bridge hardware.",
        });
      } else {
        checks.push({
          id: "protocol-ok",
          aspect: "signal-protocol",
          status: "pass",
          message: `Signal protocol "${signalProtocol}" supported cleanly on both endpoints.`,
        });
      }
    } else if (srcSignals.length > 0 && dstSignals.length > 0) {
      const common = srcSignals.filter((s) => dstSignals.includes(s));
      if (common.length === 0) {
        checks.push({
          id: "signal-disjoint",
          aspect: "signal-protocol",
          status: "error",
          message: `No overlapping signal type between "${srcSignals.join(",")}" and "${dstSignals.join(",")}".`,
          correctiveAction: "Match signal domains or use compatible I/O ports.",
        });
      } else {
        checks.push({
          id: "signal-overlap-ok",
          aspect: "signal-protocol",
          status: "pass",
          message: `Compatible signal type(s): ${common.join(", ")}.`,
        });
      }
    }
  }

  // 5. Pin-level capabilities if specific pins supplied
  if (sourcePin && targetPin) {
    conditionsEvaluated.push("pin-capability");
    checks.push(evaluatePinCapabilities(sourcePin, targetPin, signalProtocol));
  }

  // 6. Connector physical compatibility (distinguished from electrical compatibility!)
  if (sourceConnector || targetConnector) {
    conditionsEvaluated.push("connector-physical");
    checks.push(evaluateConnectorCompatibility(sourceConnector, targetConnector));
  }

  for (const c of checks) {
    if (c.status === "warning") warnings.push(c.message);
  }

  // Note: connector-only unknown shouldn't mask an electrical incompatibility error!
  let status: ElectricalCompatibilityStatus = "compatible";
  if (checks.some((c) => c.status === "error")) {
    status = "incompatible";
  } else if (
    checks.some(
      (c) =>
        c.status === "unknown" &&
        c.aspect !== "connector-physical"
    )
  ) {
    status = "unknown";
  } else if (checks.some((c) => c.status === "warning")) {
    status = "compatible-with-warnings";
  } else if (checks.every((c) => c.status === "unknown")) {
    status = "unknown";
  }

  const primaryError = checks.find((c) => c.status === "error");
  const primaryUnknown = checks.find((c) => c.status === "unknown");
  const primaryWarning = checks.find((c) => c.status === "warning");

  const reason =
    primaryError?.message ??
    primaryUnknown?.message ??
    primaryWarning?.message ??
    checks[0]?.message ??
    "Electrical connection validated cleanly.";

  const correctiveAction =
    primaryError?.correctiveAction ??
    primaryWarning?.correctiveAction ??
    primaryUnknown?.correctiveAction;

  return {
    status,
    reason,
    checks,
    conditionsEvaluated,
    warnings,
    assumptions,
    missingInformation,
    correctiveAction,
    provenance: combineProvenance(
      sourceInterface.provenance,
      targetInterface.provenance
    ),
  };
}
