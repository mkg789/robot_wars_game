import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import type { DrivetrainInput, SimulationRobotConfig } from "../../simulation/types/simulation.types";
import type { SimulationTelemetrySnapshot } from "../../simulation/types/simulationWorld.types";
import {
  applyCommandToDriveTarget,
  NEUTRAL_NORMALIZED_TARGET,
  resolveRobotHardwareBinding,
} from "./controlCommandPipeline";
import {
  buildProgramStepContext,
  type CommandNormalizationResult,
  type MotorChannelTarget,
  type MotorHardwareBinding,
  type NormalizedDriveTarget,
  type RobotActuatorCommand,
  type RobotControlApi,
  type RobotControlRoutine,
  type RobotControlSource,
  type RobotProgramControllerState,
  type RobotProgramStatus,
} from "../types/control.types";

/**
 * Encapsulates user/autonomous robot program execution, typed control commands,
 * normalization, and hardware gating strictly upstream of SimulationRunner physics.
 */
export class RobotControlController implements RobotControlApi {
  private binding: MotorHardwareBinding;
  private controlSource: RobotControlSource = "manual";
  private programStatus: RobotProgramStatus = "idle";
  private routine: RobotControlRoutine | null = null;
  private target: NormalizedDriveTarget = NEUTRAL_NORMALIZED_TARGET;
  private latestTimeSeconds = 0;
  private lastWarnings: readonly string[] = [];
  private commandLogCount = 0;
  private lastError: string | null = null;

  constructor(params: {
    readonly robotConfig: SimulationRobotConfig;
    readonly parts?: readonly RobotPart[];
    readonly electricalConnections?: readonly ElectricalConnection[];
  }) {
    this.binding = resolveRobotHardwareBinding(params);
  }

  updateHardwareContext(params: {
    readonly robotConfig: SimulationRobotConfig;
    readonly parts?: readonly RobotPart[];
    readonly electricalConnections?: readonly ElectricalConnection[];
  }): void {
    this.binding = resolveRobotHardwareBinding(params);
    if (!this.binding.canDrive) {
      this.target = NEUTRAL_NORMALIZED_TARGET;
    }
  }

  getControlSource(): RobotControlSource {
    return this.controlSource;
  }

  setControlSource(source: RobotControlSource): void {
    if (source === "manual" && this.programStatus === "running") {
      this.stopProgram();
    }
    this.controlSource = source;
  }

  setProgramRoutine(routine: RobotControlRoutine | null): void {
    if (this.programStatus === "running") {
      this.stopProgram();
    }
    this.routine = routine;
    this.programStatus = "idle";
    this.lastError = null;
  }

  startProgram(): boolean {
    if (!this.routine) {
      this.lastError = "No robot program selected to run.";
      this.programStatus = "fault";
      return false;
    }
    if (!this.binding.canDrive) {
      this.lastError =
        this.binding.faultReason ?? "Robot hardware binding cannot drive motors.";
      this.programStatus = "fault";
      this.stopRobot();
      return false;
    }
    this.controlSource = "program";
    this.programStatus = "running";
    this.lastError = null;
    try {
      this.routine.onStart?.(this);
      return true;
    } catch (error) {
      this.handleFault(error);
      return false;
    }
  }

  stopProgram(): void {
    const wasRunning = this.programStatus === "running";
    if (wasRunning && this.routine?.onStop) {
      try {
        this.routine.onStop(this);
      } catch {
        // Ignore user onStop cleanup exception while guaranteeing safe halt
      }
    }
    this.programStatus = "stopped";
    this.stopRobot();
  }

  completeProgram(): void {
    this.stopRobot();
    this.programStatus = "completed";
  }

  reset(): void {
    this.target = NEUTRAL_NORMALIZED_TARGET;
    this.latestTimeSeconds = 0;
    this.lastWarnings = [];
    this.lastError = null;
    this.commandLogCount = 0;
    this.programStatus = "idle";
  }

  dispatchCommand(command: RobotActuatorCommand): CommandNormalizationResult {
    const applied = applyCommandToDriveTarget({
      current: this.target,
      command,
      binding: this.binding,
      timestampSeconds: this.latestTimeSeconds,
    });
    this.target = applied.nextTarget;
    this.lastWarnings = applied.result.warnings;
    this.commandLogCount += 1;
    return applied.result;
  }

  setMotorPower(
    target: MotorChannelTarget,
    power: number
  ): CommandNormalizationResult {
    return this.dispatchCommand({
      kind: "set-motor-power",
      target,
      power,
    });
  }

  setLeftMotorPower(power: number): CommandNormalizationResult {
    return this.setMotorPower("left", power);
  }

  setRightMotorPower(power: number): CommandNormalizationResult {
    return this.setMotorPower("right", power);
  }

  setDifferentialPower(
    leftPower: number,
    rightPower: number
  ): CommandNormalizationResult {
    return this.dispatchCommand({
      kind: "set-differential-drive",
      leftPower,
      rightPower,
    });
  }

  stopMotors(target: MotorChannelTarget = "both"): CommandNormalizationResult {
    return this.dispatchCommand({
      kind: "stop-motors",
      target,
    });
  }

  stopRobot(): CommandNormalizationResult {
    return this.dispatchCommand({
      kind: "stop-robot",
    });
  }

  /**
   * Executes one deterministic program step prior to SimulationWorld physics integration
   * and returns the gated DrivetrainInput to feed into advanceSimulation.
   */
  beforePhysicsStep(
    telemetry: SimulationTelemetrySnapshot,
    dtSeconds: number
  ): DrivetrainInput {
    this.latestTimeSeconds = telemetry.timeSeconds;

    if (
      (this.controlSource === "program" || this.controlSource === "autonomous") &&
      this.programStatus === "running" &&
      this.routine
    ) {
      if (!this.binding.canDrive) {
        this.handleFault(
          new Error(
            this.binding.faultReason ??
              "Electrical or drivetrain fault prevented actuator command execution."
          )
        );
      } else {
        try {
          const ctx = buildProgramStepContext(telemetry, dtSeconds);
          this.routine.onTick(ctx, this);
        } catch (error) {
          this.handleFault(error);
        }
      }
    }

    if (!this.binding.canDrive) {
      return { leftThrottle: 0, rightThrottle: 0 };
    }

    return {
      leftThrottle: this.target.leftPower,
      rightThrottle: this.target.rightPower,
    };
  }

  getDrivetrainInput(): DrivetrainInput {
    if (!this.binding.canDrive) {
      return { leftThrottle: 0, rightThrottle: 0 };
    }
    return {
      leftThrottle: this.target.leftPower,
      rightThrottle: this.target.rightPower,
    };
  }

  getState(): RobotProgramControllerState {
    return {
      controlSource: this.controlSource,
      programStatus: this.programStatus,
      activeProgramId: this.routine?.id ?? null,
      activeProgramName: this.routine?.name ?? null,
      leftPower: this.target.leftPower,
      rightPower: this.target.rightPower,
      binding: this.binding,
      lastWarnings: this.lastWarnings,
      commandLogCount: this.commandLogCount,
      lastError: this.lastError,
    };
  }

  private handleFault(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.programStatus = "fault";
    this.target = NEUTRAL_NORMALIZED_TARGET;
  }
}
