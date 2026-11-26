import type { CSSProperties } from "react";
import { foundationModels } from "../../features/robot-builder/data/foundationModels";
import type { PoweredWheelAssembly } from "../../features/robot-builder/logic/drivetrain";
import {
  formatAcceleration,
  formatAngle,
  formatForce,
  formatInertia,
  formatLength,
  formatMass,
  formatPercentage,
  formatSpeed,
  formatYawRate,
} from "../../features/robot-builder/logic/formatters";
import type { RobotInertiaProfile } from "../../features/robot-builder/logic/robotInertia";
import type { RobotPerformanceProfile } from "../../features/robot-builder/logic/robotKinematics";
import type { RobotStabilityProfile } from "../../features/robot-builder/logic/robotStability";
import type {
  BatteryDefinition,
  BuildStage,
  ControllerDefinition,
  DrivetrainConfiguration,
  FoundationConfig,
  RobotPart,
} from "../../features/robot-builder/types/robot.types";

export interface CompletedBuildSummaryProps {
  readonly foundation: FoundationConfig;
  readonly installedBatteryDefinition: BatteryDefinition | undefined;
  readonly installedControllerDefinition: ControllerDefinition | undefined;
  readonly mountedMotors: RobotPart[];
  readonly mountedWheels: RobotPart[];
  readonly wheelByMotorId: Map<string, RobotPart>;
  readonly drivetrain: DrivetrainConfiguration;
  readonly poweredWheelAssemblies: PoweredWheelAssembly[];
  readonly performanceProfile: RobotPerformanceProfile;
  readonly stabilityProfile: RobotStabilityProfile;
  readonly inertiaProfile: RobotInertiaProfile;
  readonly getMotorLocationLabel: (motor: RobotPart) => string;
  readonly onSetStage: (stage: BuildStage) => void;
}

function getStatusPillStyle(tone: "stable" | "valid" | "marginal" | string): CSSProperties {
  const isOk = tone === "stable" || tone === "valid";
  const isMarginal = tone === "marginal";
  return {
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    backgroundColor: isOk
      ? "rgba(22, 101, 52, 0.25)"
      : isMarginal
        ? "rgba(133, 77, 14, 0.25)"
        : "rgba(185, 28, 28, 0.25)",
    color: isOk ? "#86efac" : isMarginal ? "#fcd34d" : "#fca5a5",
    border: `1px solid ${isOk ? "#166534" : isMarginal ? "#854d0e" : "#7f1d1d"}`,
  };
}

export function CompletedBuildSummary({
  foundation,
  installedBatteryDefinition,
  installedControllerDefinition,
  mountedMotors,
  mountedWheels,
  wheelByMotorId,
  drivetrain,
  poweredWheelAssemblies,
  performanceProfile,
  stabilityProfile,
  inertiaProfile,
  getMotorLocationLabel,
  onSetStage,
}: CompletedBuildSummaryProps) {
  return (
    <>
      <div className="section-label">ROBOT BUILD SUMMARY</div>
      <div className="motor-spec-card">
        <strong>
          {foundationModels.find((model) => model.id === foundation.modelId)?.name}
        </strong>
        <div className="property-row">
          <span>Foundation</span>
          <span>
            {foundation.length.toFixed(2)} × {foundation.width.toFixed(2)} ×{" "}
            {foundation.height.toFixed(2)} m
          </span>
        </div>
        <div className="property-row">
          <span>Battery</span>
          <span>{installedBatteryDefinition?.name ?? "None installed"}</span>
        </div>
        <div className="property-row">
          <span>Controller</span>
          <span>{installedControllerDefinition?.name ?? "None installed"}</span>
        </div>
        <div className="property-row">
          <span>Installed motors</span>
          <span>{mountedMotors.length}</span>
        </div>
        <div className="property-row">
          <span>Installed wheels</span>
          <span>{mountedWheels.length}</span>
        </div>
      </div>

      <div className="section-label">MOTORS & WHEELS</div>
      {mountedMotors.map((motor) => (
        <div className="installed-motor" key={motor.id}>
          <span>{motor.name}</span>
          <small>
            {getMotorLocationLabel(motor)}
            {" · "}
            {wheelByMotorId.get(motor.id)?.name ?? "No wheel"}
          </small>
        </div>
      ))}

      <div className="section-label">DRIVETRAIN</div>
      <div className="drivetrain-summary-card">
        <strong>
          {drivetrain.type === "differential-2"
            ? "Differential Drive · 2 wheel"
            : "4-Wheel Differential Drive"}
        </strong>
        <span className="drivetrain-status valid">Configuration valid</span>
        {(["left", "right"] as const).map((side) => (
          <div className="drivetrain-summary-side" key={side}>
            <strong>{side === "left" ? "Left" : "Right"} drive group</strong>
            {drivetrain[side].map((assignment, index) => {
              if (!assignment) return null;
              const assembly = poweredWheelAssemblies.find(
                (item) =>
                  item.motorId === assignment.motorId &&
                  item.wheelId === assignment.wheelId
              );
              return assembly ? (
                <small key={`${side}-complete-${index}`}>
                  {assembly.mountingLocation}: {assembly.motor.name} ·{" "}
                  {assembly.wheel.name}
                </small>
              ) : null;
            })}
          </div>
        ))}
      </div>

      <div className="section-label">THEORETICAL PERFORMANCE</div>
      <div className="motor-spec-card">
        <div className="property-row">
          <span>Total mass</span>
          <span>{formatMass(performanceProfile.totalMassKg)}</span>
        </div>
        <div className="property-row">
          <span>Top speed</span>
          <span>
            {performanceProfile.topSpeedMps !== undefined
              ? `${formatSpeed(performanceProfile.topSpeedMps)} (${formatSpeed(performanceProfile.topSpeedKmh, "km/h")})`
              : "Unavailable"}
          </span>
        </div>
        <div className="property-row">
          <span>Est. push force</span>
          <span>
            {performanceProfile.theoreticalPushForceN !== undefined
              ? `${formatForce(performanceProfile.theoreticalPushForceN)} (${performanceProfile.pushForceLimiter === "motor-torque" ? "torque limited" : "traction limited"})`
              : "Unavailable"}
          </span>
        </div>
        <div className="property-row">
          <span>Est. acceleration</span>
          <span>
            {performanceProfile.maxAccelerationMps2 !== undefined
              ? `${formatAcceleration(performanceProfile.maxAccelerationMps2)} (${formatAcceleration(performanceProfile.maxAccelerationG, "g")})`
              : "Unavailable"}
          </span>
        </div>
        <div className="property-row">
          <span>Push-to-weight ratio</span>
          <span>
            {performanceProfile.pushToWeightRatio !== undefined
              ? `${performanceProfile.pushToWeightRatio.toFixed(2)} : 1`
              : "Unavailable"}
          </span>
        </div>
        <div className="property-row">
          <span>Track width</span>
          <span>
            {performanceProfile.trackWidthM !== undefined
              ? formatLength(performanceProfile.trackWidthM, "m")
              : "Unavailable"}
          </span>
        </div>
        <div className="property-row">
          <span>Wheelbase</span>
          <span>
            {performanceProfile.wheelbaseM !== undefined
              ? performanceProfile.wheelbaseM === 0
                ? "Single axle (0 m)"
                : formatLength(performanceProfile.wheelbaseM, "m")
              : "Unavailable"}
          </span>
        </div>
        <div className="property-row">
          <span>Turning rate (yaw)</span>
          <span>
            {performanceProfile.maxYawRateDegPerSec !== undefined
              ? `${formatYawRate(performanceProfile.maxYawRateDegPerSec)} (${formatYawRate(performanceProfile.maxYawRateRadPerSec, "rad/s")})`
              : "Unavailable"}
          </span>
        </div>
        <small
          style={{
            display: "block",
            padding: "8px 10px",
            color: "#64748b",
            fontSize: "10px",
            lineHeight: "1.4",
          }}
        >
          Theoretical performance estimates based on component specifications and zero-slip kinematic assumptions. Not simulated dynamics.
        </small>
      </div>

      <div className="section-label">MASS DISTRIBUTION &amp; STATIC STABILITY</div>
      <div className="motor-spec-card">
        <div className="property-row">
          <span>Stability status</span>
          <span style={getStatusPillStyle(stabilityProfile.stabilityStatus)}>
            {stabilityProfile.stabilityStatus}
          </span>
        </div>

        <div style={{ marginTop: "6px", marginBottom: "4px", fontSize: "11px", fontWeight: 600, color: "#94a3b8" }}>
          CENTER OF MASS (CoM)
        </div>
        <div className="property-row">
          <span>CoM position (X, Y, Z)</span>
          <span>
            {formatLength(stabilityProfile.centerOfMass.x, "m", { trimTrailingZeros: true })} ·{" "}
            {formatLength(stabilityProfile.centerOfMass.y, "m", { trimTrailingZeros: true })} ·{" "}
            {formatLength(stabilityProfile.centerOfMass.z, "m", { trimTrailingZeros: true })}
          </span>
        </div>
        <div className="property-row">
          <span>Height above ground</span>
          <span>{formatLength(stabilityProfile.centerOfMass.heightAboveGroundM, "m")}</span>
        </div>

        <div style={{ marginTop: "8px", marginBottom: "4px", fontSize: "11px", fontWeight: 600, color: "#94a3b8" }}>
          MASS &amp; WHEEL LOAD DISTRIBUTION
        </div>
        <div className="property-row">
          <span>Total assembly mass</span>
          <span>{formatMass(stabilityProfile.centerOfMass.totalMassKg)}</span>
        </div>
        <div className="property-row">
          <span>Driven-wheel load</span>
          <span>
            {formatPercentage(stabilityProfile.wheelLoadDistribution.drivenLoadFraction, { decimals: 1 })}{" "}
            ({formatForce(stabilityProfile.wheelLoadDistribution.drivenNormalForceN)})
          </span>
        </div>
        <div className="property-row">
          <span>Driven supported mass</span>
          <span>{formatMass(stabilityProfile.wheelLoadDistribution.drivenMassEquivalentKg)}</span>
        </div>

        {stabilityProfile.wheelLoadDistribution.perWheelLoads.length > 0 && (
          <div style={{ margin: "6px 0", padding: "6px 8px", background: "rgba(15, 23, 42, 0.4)", borderRadius: "4px" }}>
            <div style={{ fontSize: "10px", color: "#64748b", marginBottom: "4px" }}>Per-wheel normal loads:</div>
            {stabilityProfile.wheelLoadDistribution.perWheelLoads.map((w) => (
              <div key={w.partId} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "2px 0" }}>
                <span>{w.location ? w.location.toUpperCase() : w.name}</span>
                <span>
                  {formatForce(w.normalForceN)} ({formatPercentage(w.loadFraction, { decimals: 0 })})
                </span>
              </div>
            ))}
            {stabilityProfile.wheelLoadDistribution.skidNormalForceN !== undefined && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "2px 0", color: "#94a3b8" }}>
                <span>PASSIVE SKID</span>
                <span>
                  {formatForce(stabilityProfile.wheelLoadDistribution.skidNormalForceN)} ({formatPercentage(stabilityProfile.wheelLoadDistribution.skidLoadFraction, { decimals: 0 })})
                </span>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: "8px", marginBottom: "4px", fontSize: "11px", fontWeight: 600, color: "#94a3b8" }}>
          STATIC STABILITY &amp; TIPPING LIMITS
        </div>
        <div className="property-row">
          <span>Min stability margin</span>
          <span>
            {stabilityProfile.minimumStabilityMarginM !== undefined
              ? formatLength(stabilityProfile.minimumStabilityMarginM, "m")
              : "Unavailable"}
          </span>
        </div>
        <div className="property-row">
          <span>Forward tipping angle</span>
          <span>
            {stabilityProfile.forwardTipAngleDeg !== undefined
              ? formatAngle(stabilityProfile.forwardTipAngleDeg)
              : "Unavailable"}
          </span>
        </div>
        <div className="property-row">
          <span>Backward tipping angle</span>
          <span>
            {stabilityProfile.backwardTipAngleDeg !== undefined
              ? formatAngle(stabilityProfile.backwardTipAngleDeg)
              : "Unavailable"}
          </span>
        </div>
        <div className="property-row">
          <span>Lateral tipping angle (min)</span>
          <span>
            {stabilityProfile.minTipAngleDeg !== undefined
              ? formatAngle(
                  Math.min(
                    stabilityProfile.leftTipAngleDeg ?? Infinity,
                    stabilityProfile.rightTipAngleDeg ?? Infinity
                  )
                )
              : "Unavailable"}
          </span>
        </div>

        <small
          style={{
            display: "block",
            padding: "8px 10px",
            color: "#64748b",
            fontSize: "10px",
            lineHeight: "1.4",
          }}
        >
          Analytical static equilibrium estimates (flat ground, rigid body). Component positions represent geometric centroids. Not simulated dynamic rollover.
        </small>
      </div>

      <div className="section-label">ROTATIONAL MASS &amp; INERTIA</div>
      <div className="motor-spec-card">
        <div className="property-row">
          <span>Inertia validity</span>
          <span style={getStatusPillStyle(inertiaProfile.validity)}>
            {inertiaProfile.validity}
          </span>
        </div>

        <div className="property-row">
          <span>Total mass used</span>
          <span>{formatMass(inertiaProfile.totalMassKg)}</span>
        </div>

        <div style={{ marginTop: "6px", marginBottom: "4px", fontSize: "11px", fontWeight: 600, color: "#94a3b8" }}>
          BODY-FRAME MOMENTS OF INERTIA (CoM)
        </div>
        <div className="property-row">
          <span>Ixx (Roll inertia)</span>
          <span>{formatInertia(inertiaProfile.bodyMomentsOfInertia.ixx)}</span>
        </div>
        <div className="property-row">
          <span>Iyy (Yaw inertia)</span>
          <span>{formatInertia(inertiaProfile.bodyMomentsOfInertia.iyy)}</span>
        </div>
        <div className="property-row">
          <span>Izz (Pitch inertia)</span>
          <span>{formatInertia(inertiaProfile.bodyMomentsOfInertia.izz)}</span>
        </div>

        <div style={{ marginTop: "6px", marginBottom: "4px", fontSize: "11px", fontWeight: 600, color: "#94a3b8" }}>
          RADII OF GYRATION
        </div>
        <div className="property-row">
          <span>kx · ky · kz</span>
          <span>
            {formatLength(inertiaProfile.radiiOfGyration.kx, "m")} ·{" "}
            {formatLength(inertiaProfile.radiiOfGyration.ky, "m")} ·{" "}
            {formatLength(inertiaProfile.radiiOfGyration.kz, "m")}
          </span>
        </div>

        <div style={{ marginTop: "6px", marginBottom: "4px", fontSize: "11px", fontWeight: 600, color: "#94a3b8" }}>
          PRODUCTS OF INERTIA (CoM)
        </div>
        <div className="property-row">
          <span>Ixy · Ixz · Iyz</span>
          <span>
            {formatInertia(inertiaProfile.tensor[0][1], "kg·m²", { decimals: 3 })} ·{" "}
            {formatInertia(inertiaProfile.tensor[0][2], "kg·m²", { decimals: 3 })} ·{" "}
            {formatInertia(inertiaProfile.tensor[1][2], "kg·m²", { decimals: 3 })}
          </span>
        </div>

        {inertiaProfile.warnings.length > 0 && (
          <div style={{ margin: "6px 0", padding: "6px 8px", background: "rgba(15, 23, 42, 0.4)", borderRadius: "4px" }}>
            <div style={{ fontSize: "10px", color: "#fcd34d", marginBottom: "2px" }}>Approximation Notes:</div>
            {inertiaProfile.warnings.slice(0, 3).map((w, idx) => (
              <div key={idx} style={{ fontSize: "10px", color: "#94a3b8", lineHeight: "1.3" }}>
                • {w}
              </div>
            ))}
          </div>
        )}

        <small
          style={{
            display: "block",
            padding: "8px 10px",
            color: "#64748b",
            fontSize: "10px",
            lineHeight: "1.4",
          }}
        >
          Analytical rigid-body inertia tensor relative to assembly CoM. Components modeled as uniform homogeneous solids. Not dynamic simulation.
        </small>
      </div>
      <button
        className="stage-back-button"
        onClick={() => onSetStage("drivetrain")}
      >
        Edit Drivetrain
      </button>
      <button
        className="stage-back-button"
        onClick={() => onSetStage("foundation")}
      >
        Edit Foundation
      </button>
      <button
        className="stage-back-button"
        onClick={() => onSetStage("battery")}
      >
        Edit Battery
      </button>
      <button
        className="stage-back-button"
        onClick={() => onSetStage("controller")}
      >
        Edit Controller
      </button>
      <button
        className="stage-back-button"
        onClick={() => onSetStage("motors")}
      >
        Edit Motors
      </button>
      <button
        className="stage-back-button"
        onClick={() => onSetStage("wheels")}
      >
        Edit Wheels
      </button>
    </>
  );
}
