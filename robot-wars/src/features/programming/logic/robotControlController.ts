import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import type { ArenaConfig } from "../../simulation/types/arena.types";
import type {
  DrivetrainInput,
  SimulationRobotConfig,
  SimulationState,
} from "../../simulation/types/simulation.types";
import type { SimulationTelemetrySnapshot } from "../../simulation/types/simulationWorld.types";
import {
  applyCommandToDriveTarget,
  NEUTRAL_NORMALIZED_TARGET,
  resolveRobotHardwareBinding,
} from "./controlCommandPipeline";
import { resolveRobotSensors } from "./sensorResolver";
import {
  buildRobotSensorsSnapshot,
  simulateDistanceSensor,
  simulateEncoderSensor,
  simulateImuSensor,
  simulateIrProximitySensor,
  simulateLineSensor,
} from "./sensorSimulation";
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
import type {
  EncoderAccumulatorState,
  EncoderData,
  ImuData,
  IrProximityData,
  LineSensorData,
  RobotSensorsSnapshot,
  SensorDescriptor,
  SensorReadResult,
  UltrasonicDistanceData,
} from "../types/sensor.types";
import type { VisualProgramExecutionTrace } from "../types/programWorkspace.types";

/**
 * Encapsulates user/autonomous robot program execution, typed control commands,
 * normalization, and hardware gating strictly upstream of SimulationRunner physics.
 */
export class RobotControlController implements RobotControlApi {
  private robotConfig: SimulationRobotConfig;
  private binding: MotorHardwareBinding;
  private sensorDescriptors: readonly SensorDescriptor[] = [];
  private arena: ArenaConfig | null = null;
  private simState: SimulationState | null = null;
  private encoderAccumulator: EncoderAccumulatorState = {
    leftRadians: 0,
    rightRadians: 0,
    leftDistanceMeters: 0,
    rightDistanceMeters: 0,
  };
  private controlSource: RobotControlSource = "manual";
  private programStatus: RobotProgramStatus = "idle";
  private routine: RobotControlRoutine | null = null;
  private target: NormalizedDriveTarget = NEUTRAL_NORMALIZED_TARGET;
  private pausedTarget: NormalizedDriveTarget | null = null;
  private latestTimeSeconds = 0;
  private lastWarnings: readonly string[] = [];
  private commandLogCount = 0;
  private lastError: string | null = null;
  private executionTrace: VisualProgramExecutionTrace | null = null;

  constructor(params: {
    readonly robotConfig: SimulationRobotConfig;
    readonly parts?: readonly RobotPart[];
    readonly electricalConnections?: readonly ElectricalConnection[];
    readonly arena?: ArenaConfig;
    readonly simState?: SimulationState;
  }) {
    this.robotConfig = params.robotConfig;
    this.binding = resolveRobotHardwareBinding(params);
    this.sensorDescriptors = resolveRobotSensors({
      parts: params.parts ?? [],
      electricalConnections: params.electricalConnections,
    });
    this.arena = params.arena ?? null;
    this.simState = params.simState ?? null;
  }

  updateHardwareContext(params: {
    readonly robotConfig: SimulationRobotConfig;
    readonly parts?: readonly RobotPart[];
    readonly electricalConnections?: readonly ElectricalConnection[];
    readonly trippedFuseIds?: readonly string[];
    readonly isBatteryCutoff?: boolean;
  }): void {
    this.robotConfig = params.robotConfig;
    this.binding = resolveRobotHardwareBinding(params);
    this.sensorDescriptors = resolveRobotSensors({
      parts: params.parts ?? [],
      electricalConnections: params.electricalConnections,
      trippedFuseIds: params.trippedFuseIds,
      isBatteryCutoff: params.isBatteryCutoff,
    });
    if (!this.binding.canDrive) {
      this.target = NEUTRAL_NORMALIZED_TARGET;
      this.pausedTarget = null;
    }
  }

  updateSensorContext(params: {
    readonly arena: ArenaConfig;
    readonly simState: SimulationState;
    readonly encoderAccumulator: EncoderAccumulatorState;
  }): void {
    this.arena = params.arena;
    this.simState = params.simState;
    this.encoderAccumulator = params.encoderAccumulator;
  }

  getInstalledSensors(): readonly SensorDescriptor[] {
    return this.sensorDescriptors;
  }

  readUltrasonic(sensorId?: string): SensorReadResult<UltrasonicDistanceData> {
    if (!this.arena || !this.simState) {
      return {
        ok: false,
        status: "not-installed",
        sensorId: null,
        sensorName: null,
        sensorKind: "ultrasonic",
        timestampSeconds: this.latestTimeSeconds,
        reason: "Simulation arena or state unavailable.",
        assumptions: [],
        data: null,
      };
    }
    return simulateDistanceSensor({
      descriptors: this.sensorDescriptors,
      simState: this.simState,
      arena: this.arena,
      sensorId,
    });
  }

  readProximity(sensorId?: string): SensorReadResult<IrProximityData> {
    if (!this.arena || !this.simState) {
      return {
        ok: false,
        status: "not-installed",
        sensorId: null,
        sensorName: null,
        sensorKind: "ir-proximity",
        timestampSeconds: this.latestTimeSeconds,
        reason: "Simulation arena or state unavailable.",
        assumptions: [],
        data: null,
      };
    }
    return simulateIrProximitySensor({
      descriptors: this.sensorDescriptors,
      simState: this.simState,
      arena: this.arena,
      sensorId,
    });
  }

  readLineSensor(sensorId?: string): SensorReadResult<LineSensorData> {
    if (!this.arena || !this.simState) {
      return {
        ok: false,
        status: "not-installed",
        sensorId: null,
        sensorName: null,
        sensorKind: "line-sensor",
        timestampSeconds: this.latestTimeSeconds,
        reason: "Simulation arena or state unavailable.",
        assumptions: [],
        data: null,
      };
    }
    return simulateLineSensor({
      descriptors: this.sensorDescriptors,
      simState: this.simState,
      arena: this.arena,
      sensorId,
    });
  }

  readImu(sensorId?: string): SensorReadResult<ImuData> {
    if (!this.simState) {
      return {
        ok: false,
        status: "not-installed",
        sensorId: null,
        sensorName: null,
        sensorKind: "imu",
        timestampSeconds: this.latestTimeSeconds,
        reason: "Simulation state unavailable.",
        assumptions: [],
        data: null,
      };
    }
    return simulateImuSensor({
      descriptors: this.sensorDescriptors,
      simState: this.simState,
      sensorId,
    });
  }

  readEncoder(
    sideOrSensorId: "left" | "right" | "average" | string = "average"
  ): SensorReadResult<EncoderData> {
    if (!this.simState) {
      return {
        ok: false,
        status: "not-installed",
        sensorId: null,
        sensorName: null,
        sensorKind: "encoder",
        timestampSeconds: this.latestTimeSeconds,
        reason: "Simulation state unavailable.",
        assumptions: [],
        data: null,
      };
    }
    return simulateEncoderSensor({
      descriptors: this.sensorDescriptors,
      robotConfig: this.robotConfig,
      simState: this.simState,
      accumulator: this.encoderAccumulator,
      sideOrSensorId,
    });
  }

  readSensorsSnapshot(): RobotSensorsSnapshot | null {
    if (!this.arena || !this.simState) return null;
    return buildRobotSensorsSnapshot({
      descriptors: this.sensorDescriptors,
      robotConfig: this.robotConfig,
      simState: this.simState,
      arena: this.arena,
      accumulator: this.encoderAccumulator,
    });
  }

  getControlSource(): RobotControlSource {
    return this.controlSource;
  }

  setControlSource(source: RobotControlSource): void {
    if (
      source === "manual" &&
      (this.programStatus === "running" || this.programStatus === "paused")
    ) {
      this.stopProgram();
    }
    this.controlSource = source;
  }

  reportExecutionTrace(trace: VisualProgramExecutionTrace): void {
    this.executionTrace = trace;
  }

  setProgramRoutine(routine: RobotControlRoutine | null): void {
    this.pausedTarget = null;
    if (this.programStatus === "running" || this.programStatus === "paused") {
      this.stopProgram();
    }
    this.routine = routine;
    this.programStatus = "idle";
    this.lastError = null;
    this.executionTrace = null;
  }

  startProgram(): boolean {
    if (!this.routine) {
      this.handleFault(new Error("No robot program selected to run."));
      return false;
    }
    if (!this.binding.canDrive) {
      this.handleFault(
        new Error(
          this.binding.faultReason ?? "Robot hardware binding cannot drive motors."
        )
      );
      return false;
    }
    this.controlSource = "program";
    this.programStatus = "running";
    this.target = NEUTRAL_NORMALIZED_TARGET;
    this.pausedTarget = null;
    this.lastError = null;
    this.executionTrace = null;
    try {
      this.routine.onStart?.(this);
      return true;
    } catch (error) {
      this.handleFault(error);
      return false;
    }
  }

  pauseProgram(): boolean {
    if (this.programStatus !== "running") {
      return false;
    }
    this.pausedTarget = this.target;
    this.programStatus = "paused";
    this.stopRobot();
    if (this.executionTrace) {
      this.executionTrace = {
        ...this.executionTrace,
        statusMessage: "Paused by user",
      };
    }
    return true;
  }

  resumeProgram(): boolean {
    if (this.programStatus !== "paused" || !this.routine) {
      return false;
    }
    if (!this.binding.canDrive) {
      this.handleFault(
        new Error(
          this.binding.faultReason ?? "Robot hardware binding cannot drive motors."
        )
      );
      return false;
    }
    this.controlSource = "program";
    this.programStatus = "running";
    if (this.pausedTarget) {
      this.target = this.pausedTarget;
      this.pausedTarget = null;
    }
    this.lastError = null;
    try {
      this.routine.onResume?.(this);
      return true;
    } catch (error) {
      this.handleFault(error);
      return false;
    }
  }

  stepProgramInstruction(
    telemetry: SimulationTelemetrySnapshot,
    dtSeconds: number
  ): DrivetrainInput {
    this.latestTimeSeconds = telemetry.timeSeconds;

    if (!this.routine) {
      this.handleFault(new Error("No robot program selected to step."));
      return { leftThrottle: 0, rightThrottle: 0 };
    }
    if (
      this.programStatus === "completed" ||
      this.programStatus === "stopped" ||
      this.programStatus === "fault"
    ) {
      return { leftThrottle: 0, rightThrottle: 0 };
    }
    if (!this.binding.canDrive) {
      this.handleFault(
        new Error(
          this.binding.faultReason ??
            "Electrical or drivetrain fault prevented actuator command execution."
        )
      );
      return { leftThrottle: 0, rightThrottle: 0 };
    }

    const wasIdle = this.programStatus === "idle";
    const wasRunning = this.programStatus === "running";
    this.controlSource = "program";
    this.programStatus = "paused";
    this.lastError = null;

    try {
      if (wasIdle) {
        this.target = NEUTRAL_NORMALIZED_TARGET;
        this.pausedTarget = null;
        this.executionTrace = null;
        this.routine.onStart?.(this);
      } else if (!wasRunning) {
        if (this.pausedTarget) {
          this.target = this.pausedTarget;
          this.pausedTarget = null;
        }
        this.routine.onResume?.(this);
      }

      const ctx = buildProgramStepContext(
        telemetry,
        dtSeconds,
        this.readSensorsSnapshot() ?? undefined,
        true
      );
      this.routine.onTick(ctx, this);
    } catch (error) {
      this.handleFault(error);
      return { leftThrottle: 0, rightThrottle: 0 };
    }

    if ((this.programStatus as RobotProgramStatus) === "completed") {
      return { leftThrottle: 0, rightThrottle: 0 };
    }
    if ((this.programStatus as RobotProgramStatus) === "fault") {
      return { leftThrottle: 0, rightThrottle: 0 };
    }
    if (this.executionTrace) {
      this.executionTrace = {
        ...this.executionTrace,
        statusMessage: `Paused (single-step @ ${telemetry.timeSeconds.toFixed(2)}s)`,
      };
    }

    return {
      leftThrottle: this.target.leftPower,
      rightThrottle: this.target.rightPower,
    };
  }

  stopProgram(): void {
    const wasActive =
      this.programStatus === "running" || this.programStatus === "paused";
    const wasFault = this.programStatus === "fault";
    this.pausedTarget = null;
    if (wasActive && this.routine?.onStop) {
      try {
        this.routine.onStop(this);
      } catch {
        // Ignore user onStop cleanup exception while guaranteeing safe halt
      }
    }
    if (!wasFault) {
      this.programStatus = "stopped";
    }
    this.stopRobot();
    if (this.executionTrace && !wasFault) {
      this.executionTrace = {
        ...this.executionTrace,
        activeInstructionId: null,
        statusMessage: "Stopped by user",
      };
    }
  }

  completeProgram(): void {
    this.pausedTarget = null;
    this.stopRobot();
    this.programStatus = "completed";
  }

  reset(): void {
    this.pausedTarget = null;
    this.controlSource = "manual";
    this.target = NEUTRAL_NORMALIZED_TARGET;
    this.latestTimeSeconds = 0;
    this.lastWarnings = [];
    this.lastError = null;
    this.commandLogCount = 0;
    this.programStatus = "idle";
    this.executionTrace = null;
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
          const ctx = buildProgramStepContext(
            telemetry,
            dtSeconds,
            this.readSensorsSnapshot() ?? undefined
          );
          this.routine.onTick(ctx, this);
        } catch (error) {
          this.handleFault(error);
        }
      }
    }

    if (!this.binding.canDrive) {
      return { leftThrottle: 0, rightThrottle: 0 };
    }
    if (
      this.controlSource !== "manual" &&
      this.programStatus === "paused"
    ) {
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
    if (
      this.controlSource !== "manual" &&
      this.programStatus === "paused"
    ) {
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
      executionTrace: this.executionTrace,
    };
  }

  private handleFault(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;
    this.programStatus = "fault";
    this.pausedTarget = null;
    this.target = NEUTRAL_NORMALIZED_TARGET;
    const prevTrace = this.executionTrace;
    const failedId = prevTrace?.activeInstructionId ?? null;
    const faultEntry = {
      id: `fault-${(prevTrace?.history.length ?? 0) + 1}`,
      instructionId: failedId ?? "__runtime__",
      instructionKind: "stop" as const,
      title: failedId ? "Instruction Execution Fault" : "Program Runtime Fault",
      paramsSummary: "Isolated runtime exception",
      outcome: "fault" as const,
      details: message,
      timestampSeconds: this.latestTimeSeconds,
      motorPower: { left: 0, right: 0 },
    };
    const nextHistory = [...(prevTrace?.history ?? []), faultEntry].slice(-40);
    this.executionTrace = {
      activeInstructionId: null,
      completedInstructionIds: prevTrace?.completedInstructionIds ?? [],
      skippedInstructionIds: prevTrace?.skippedInstructionIds ?? [],
      failedInstructionId: failedId,
      repeatProgressById: prevTrace?.repeatProgressById ?? {},
      lastSensorSummary: prevTrace?.lastSensorSummary ?? null,
      lastSensorStatus: prevTrace?.lastSensorStatus ?? null,
      lastBranchOutcome: prevTrace?.lastBranchOutcome ?? null,
      statusMessage: `Fault: ${message}`,
      errorMessage: message,
      history: nextHistory,
    };
  }
}
