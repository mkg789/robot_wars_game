import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import type { ArenaConfig } from "../../simulation/types/arena.types";
import type {
  DrivetrainInput,
  RuntimeElectricalState,
  SimulationRobotConfig,
  SimulationState,
} from "../../simulation/types/simulation.types";
import type { SimulationTelemetrySnapshot } from "../../simulation/types/simulationWorld.types";
import {
  applyCommandToDriveTarget,
  NEUTRAL_NORMALIZED_TARGET,
  resolveRobotHardwareBinding,
} from "./controlCommandPipeline";
import { ClosedLoopMotionController } from "./closedLoopMotionController";
import { createDifferentialDriveModel } from "./differentialDriveControl";
import { DifferentialDriveOdometryTracker } from "./differentialDriveOdometry";
import { ReactiveObstacleAvoidanceController } from "./reactiveObstacleAvoidanceController";
import { WaypointNavigationController } from "./waypointNavigationController";
import { resolveRobotSensors } from "./sensorResolver";
import {
  buildRobotSensorsSnapshot,
  readAllDistanceSensors,
  simulateDistanceSensor,
  simulateEncoderSensor,
  simulateImuSensor,
  simulateIrProximitySensor,
  simulateLineSensor,
} from "./sensorSimulation";
import {
  buildProgramStepContext,
  type ClosedLoopMotionOptions,
  type ClosedLoopMotionState,
  type CommandNormalizationResult,
  type DifferentialDriveGeometryOverride,
  type DifferentialDriveModel,
  type DifferentialDriveOdometryState,
  type DifferentialDriveResolution,
  type DistanceSensorObservation,
  type MotorChannelTarget,
  type MotorHardwareBinding,
  type NavigationWaypoint,
  type NormalizedDriveTarget,
  type ObstacleAvoidanceOptions,
  type ObstacleAvoidanceState,
  type OdometryPose,
  type RobotActuatorCommand,
  type RobotControlApi,
  type RobotControlRoutine,
  type RobotControlSource,
  type RobotProgramControllerState,
  type RobotProgramStatus,
  type WaypointNavigationOptions,
  type WaypointNavigationState,
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
  private differentialModel: DifferentialDriveModel;
  private runtimeElectricalState?: RuntimeElectricalState;
  private batteryTerminalVoltageV?: number;
  private geometryOverride?: DifferentialDriveGeometryOverride;
  private lastDifferentialResolution: DifferentialDriveResolution | null = null;
  private odometryTracker: DifferentialDriveOdometryTracker;
  private motionController = new ClosedLoopMotionController();
  private navigationController = new WaypointNavigationController();
  private avoidanceController = new ReactiveObstacleAvoidanceController();
  private pausedNavigationByProgram = false;
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
    readonly runtimeElectricalState?: RuntimeElectricalState;
    readonly geometryOverride?: DifferentialDriveGeometryOverride;
  }) {
    this.robotConfig = params.robotConfig;
    this.binding = resolveRobotHardwareBinding(params);
    this.runtimeElectricalState = params.runtimeElectricalState;
    this.batteryTerminalVoltageV = params.simState?.batteryTerminalVoltageV;
    this.geometryOverride = params.geometryOverride;
    this.differentialModel = this.buildDifferentialModel();
    this.sensorDescriptors = resolveRobotSensors({
      parts: params.parts ?? [],
      electricalConnections: params.electricalConnections,
    });
    this.arena = params.arena ?? null;
    this.simState = params.simState ?? null;
    this.odometryTracker = new DifferentialDriveOdometryTracker({
      model: this.differentialModel,
      initialMeasurement: {
        descriptors: this.sensorDescriptors,
        accumulator: this.encoderAccumulator,
      },
      timestampSeconds: params.simState?.timeSeconds ?? 0,
    });
  }

  private buildDifferentialModel(): DifferentialDriveModel {
    return createDifferentialDriveModel({
      robotConfig: this.robotConfig,
      runtimeElectricalState: this.runtimeElectricalState,
      binding: this.binding,
      geometryOverride: this.geometryOverride,
      batteryTerminalVoltageV: this.batteryTerminalVoltageV,
    });
  }

  updateHardwareContext(params: {
    readonly robotConfig: SimulationRobotConfig;
    readonly parts?: readonly RobotPart[];
    readonly electricalConnections?: readonly ElectricalConnection[];
    readonly trippedFuseIds?: readonly string[];
    readonly isBatteryCutoff?: boolean;
    readonly runtimeElectricalState?: RuntimeElectricalState;
    readonly batteryTerminalVoltageV?: number;
  }): void {
    this.robotConfig = params.robotConfig;
    this.binding = resolveRobotHardwareBinding(params);
    if (params.runtimeElectricalState !== undefined) {
      this.runtimeElectricalState = params.runtimeElectricalState;
    }
    if (params.batteryTerminalVoltageV !== undefined) {
      this.batteryTerminalVoltageV = params.batteryTerminalVoltageV;
    }
    this.differentialModel = this.buildDifferentialModel();
    this.sensorDescriptors = resolveRobotSensors({
      parts: params.parts ?? [],
      electricalConnections: params.electricalConnections,
      trippedFuseIds: params.trippedFuseIds,
      isBatteryCutoff: params.isBatteryCutoff,
    });
    this.odometryTracker.update(
      this.differentialModel,
      {
        descriptors: this.sensorDescriptors,
        accumulator: this.encoderAccumulator,
      },
      this.simState?.timeSeconds ?? this.latestTimeSeconds
    );
    if (this.navigationController.isActive()) {
      const odo = this.odometryTracker.getState();
      if (this.avoidanceController.getState().enabled && this.arena && this.simState) {
        const avStep = this.avoidanceController.step({
          dtSeconds: 1 / 120,
          observations: this.readDistanceObservations(),
          odometry: odo,
          headingErrorRadians: this.navigationController.getState().headingErrorRadians,
        });
        if (avStep.state.status === "blocked") {
          this.navigationController.fail(
            avStep.state.failureReason ??
              "Obstacle avoidance blocked due to invalid/unavailable sensors.",
            this.motionController
          );
          this.target = NEUTRAL_NORMALIZED_TARGET;
          this.pausedTarget = null;
        }
      }
      if (
        this.navigationController.isActive() &&
        (!this.binding.canDrive || !this.differentialModel.isValid || !odo.isValid)
      ) {
        this.avoidanceController.cancel(
          this.binding.faultReason ??
            "Electrical or odometry fault interrupted obstacle avoidance."
        );
        this.navigationController.step({
          dtSeconds: 1 / 120,
          odometry: odo,
          model: this.differentialModel,
          binding: this.binding,
          motionController: this.motionController,
        });
        this.target = NEUTRAL_NORMALIZED_TARGET;
        this.pausedTarget = null;
      }
    }
    if (this.motionController.isActive()) {
      const odo = this.odometryTracker.getState();
      if (!this.binding.canDrive || !this.differentialModel.isValid || !odo.isValid) {
        this.motionController.step({
          dtSeconds: 1 / 120,
          odometry: odo,
          model: this.differentialModel,
          binding: this.binding,
          robotConfig: this.robotConfig,
        });
        this.target = NEUTRAL_NORMALIZED_TARGET;
        this.pausedTarget = null;
      }
    }
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
    this.batteryTerminalVoltageV = params.simState.batteryTerminalVoltageV;
    this.differentialModel = this.buildDifferentialModel();
    this.odometryTracker.update(
      this.differentialModel,
      {
        descriptors: this.sensorDescriptors,
        accumulator: this.encoderAccumulator,
      },
      params.simState.timeSeconds
    );
  }

  getOdometryState(): DifferentialDriveOdometryState {
    return this.odometryTracker.getState();
  }

  resetOdometry(
    initialPose?: Partial<Pick<OdometryPose, "xMeters" | "zMeters" | "headingRadians">>
  ): DifferentialDriveOdometryState {
    return this.odometryTracker.reset({
      initialPose,
      model: this.differentialModel,
      initialMeasurement: {
        descriptors: this.sensorDescriptors,
        accumulator: this.encoderAccumulator,
      },
      timestampSeconds: this.simState?.timeSeconds ?? this.latestTimeSeconds,
    });
  }

  setDifferentialGeometryOverride(
    override?: DifferentialDriveGeometryOverride
  ): DifferentialDriveModel {
    this.geometryOverride = override;
    this.differentialModel = this.buildDifferentialModel();
    return this.differentialModel;
  }

  getDifferentialDriveModel(): DifferentialDriveModel {
    return this.differentialModel;
  }

  getLastDifferentialDriveResolution(): DifferentialDriveResolution | null {
    return this.lastDifferentialResolution;
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
    if (source === "manual") {
      this.pausedNavigationByProgram = false;
      this.avoidanceController.cancel("Cancelled by manual control takeover.");
      this.navigationController.cancel(
        "Cancelled by manual control takeover.",
        this.motionController
      );
      this.cancelMotion("Cancelled by manual control takeover.");
      if (this.programStatus === "running" || this.programStatus === "paused") {
        this.stopProgram();
      } else {
        this.pausedTarget = null;
        if (this.controlSource !== "manual") {
          this.stopRobot();
        }
      }
    }
    this.controlSource = source;
  }

  getActiveRoutine(): RobotControlRoutine | null {
    return this.routine;
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
    this.pausedNavigationByProgram = false;
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
    if (this.navigationController.isActive()) {
      this.pausedNavigationByProgram = true;
      this.avoidanceController.pause();
      this.navigationController.pause(this.motionController);
    }
    this.target = {
      ...NEUTRAL_NORMALIZED_TARGET,
      lastCommandAtSeconds: this.latestTimeSeconds,
      activeCommandKind: "stop-robot",
    };
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
    if (this.pausedNavigationByProgram) {
      this.pausedNavigationByProgram = false;
      this.navigationController.resume({
        model: this.differentialModel,
        odometry: this.odometryTracker.getState(),
        binding: this.binding,
        motionController: this.motionController,
      });
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
        true,
        this.odometryTracker.getState(),
        this.motionController.getState(),
        this.navigationController.getState(),
        this.avoidanceController.getState()
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

    const stepInput: DrivetrainInput = {
      leftThrottle: this.target.leftPower,
      rightThrottle: this.target.rightPower,
    };
    this.pausedTarget = this.target;
    this.target = NEUTRAL_NORMALIZED_TARGET;
    return stepInput;
  }

  stopProgram(): void {
    const wasActive =
      this.programStatus === "running" || this.programStatus === "paused";
    const wasFault = this.programStatus === "fault";
    this.pausedTarget = null;
    this.pausedNavigationByProgram = false;
    this.avoidanceController.cancel("Cancelled on program stop.");
    this.navigationController.cancel("Cancelled on program stop.", this.motionController);
    this.motionController.cancel("Cancelled on program stop.");
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
    this.pausedNavigationByProgram = false;
    this.avoidanceController.cancel("Cancelled on program completion.");
    this.navigationController.cancel(
      "Cancelled on program completion.",
      this.motionController
    );
    this.motionController.cancel("Cancelled on program completion.");
    this.stopRobot();
    this.programStatus = "completed";
  }

  reset(): void {
    this.pausedTarget = null;
    this.pausedNavigationByProgram = false;
    this.controlSource = "manual";
    this.target = NEUTRAL_NORMALIZED_TARGET;
    this.latestTimeSeconds = 0;
    this.lastWarnings = [];
    this.lastError = null;
    this.commandLogCount = 0;
    this.programStatus = "idle";
    this.executionTrace = null;
    this.lastDifferentialResolution = null;
    this.avoidanceController.reset();
    this.navigationController.reset(this.motionController);
    this.motionController.reset();
    this.odometryTracker.reset({
      model: this.differentialModel,
      initialMeasurement: {
        descriptors: this.sensorDescriptors,
        accumulator: {
          leftRadians: 0,
          rightRadians: 0,
          leftDistanceMeters: 0,
          rightDistanceMeters: 0,
        },
      },
      timestampSeconds: 0,
    });
  }

  hasActiveMotion(): boolean {
    return this.motionController.isActive();
  }

  hasActiveNavigation(): boolean {
    return this.navigationController.isActive();
  }

  private readDistanceObservations(): readonly DistanceSensorObservation[] {
    if (!this.arena || !this.simState) {
      return [];
    }
    return readAllDistanceSensors({
      descriptors: this.sensorDescriptors,
      simState: this.simState,
      arena: this.arena,
    });
  }

  configureObstacleAvoidance(
    options?: ObstacleAvoidanceOptions
  ): ObstacleAvoidanceState {
    return this.avoidanceController.configure(options);
  }

  getObstacleAvoidanceState(): ObstacleAvoidanceState {
    return this.avoidanceController.getState();
  }

  resetObstacleAvoidance(): ObstacleAvoidanceState {
    return this.avoidanceController.reset();
  }

  getMotionState(): ClosedLoopMotionState {
    return this.motionController.getState();
  }

  getNavigationState(): WaypointNavigationState {
    return this.navigationController.getState();
  }

  navigateToWaypoint(
    waypoint: NavigationWaypoint,
    options?: WaypointNavigationOptions
  ): WaypointNavigationState {
    return this.navigateWaypoints([waypoint], options);
  }

  navigateWaypoints(
    waypoints: readonly NavigationWaypoint[],
    options?: WaypointNavigationOptions
  ): WaypointNavigationState {
    this.pausedNavigationByProgram = false;
    if (this.controlSource === "manual") {
      this.controlSource = "program";
    }
    const avInit = this.avoidanceController.beginNavigationSession({
      observations: this.readDistanceObservations(),
      navigationOptions: options?.obstacleAvoidance,
    });
    const next = this.navigationController.startNavigation({
      waypoints,
      model: this.differentialModel,
      odometry: this.odometryTracker.getState(),
      binding: this.binding,
      motionController: this.motionController,
      options,
    });
    if (avInit.enabled && avInit.status === "blocked" && next.isActive) {
      const blockedNav = this.navigationController.fail(
        avInit.failureReason ??
          "Obstacle avoidance blocked due to missing or unavailable distance sensors.",
        this.motionController
      );
      this.target = NEUTRAL_NORMALIZED_TARGET;
      this.lastWarnings = blockedNav.warnings;
      return blockedNav;
    }
    if (!next.isActive) {
      if (next.status === "completed") {
        this.avoidanceController.completeNavigation();
      }
      this.target = NEUTRAL_NORMALIZED_TARGET;
    }
    this.lastWarnings = next.warnings;
    return next;
  }

  pauseNavigation(): WaypointNavigationState {
    this.pausedNavigationByProgram = false;
    this.avoidanceController.pause();
    const paused = this.navigationController.pause(this.motionController);
    this.target = {
      ...NEUTRAL_NORMALIZED_TARGET,
      lastCommandAtSeconds: this.latestTimeSeconds,
      activeCommandKind: "stop-robot",
    };
    return paused;
  }

  resumeNavigation(): WaypointNavigationState {
    this.pausedNavigationByProgram = false;
    if (this.controlSource === "manual") {
      this.controlSource = "program";
    }
    const resumed = this.navigationController.resume({
      model: this.differentialModel,
      odometry: this.odometryTracker.getState(),
      binding: this.binding,
      motionController: this.motionController,
    });
    if (!resumed.isActive) {
      this.target = NEUTRAL_NORMALIZED_TARGET;
    }
    return resumed;
  }

  cancelNavigation(reason = "Navigation cancelled."): WaypointNavigationState {
    this.pausedNavigationByProgram = false;
    this.avoidanceController.cancel(reason);
    const cancelled = this.navigationController.cancel(
      reason,
      this.motionController
    );
    this.target = {
      ...NEUTRAL_NORMALIZED_TARGET,
      lastCommandAtSeconds: this.latestTimeSeconds,
      activeCommandKind: "stop-robot",
    };
    return cancelled;
  }

  resetNavigation(): WaypointNavigationState {
    this.pausedNavigationByProgram = false;
    this.avoidanceController.reset();
    const resetState = this.navigationController.reset(this.motionController);
    this.target = NEUTRAL_NORMALIZED_TARGET;
    return resetState;
  }

  trackVelocity(
    linearVelocityMps: number,
    angularVelocityRadPerSec: number,
    options?: ClosedLoopMotionOptions
  ): ClosedLoopMotionState {
    this.pausedNavigationByProgram = false;
    this.avoidanceController.cancel(
      "Replaced by closed-loop velocity hold command."
    );
    this.navigationController.cancel("Replaced by closed-loop velocity hold command.");
    if (this.controlSource === "manual") {
      this.controlSource = "program";
    }
    const next = this.motionController.startVelocityHold({
      linearVelocityMps,
      angularVelocityRadPerSec,
      model: this.differentialModel,
      odometry: this.odometryTracker.getState(),
      binding: this.binding,
      options,
    });
    if (!next.isActive) {
      this.target = NEUTRAL_NORMALIZED_TARGET;
    }
    return next;
  }

  driveDistance(
    distanceMeters: number,
    options?: ClosedLoopMotionOptions
  ): ClosedLoopMotionState {
    this.pausedNavigationByProgram = false;
    this.avoidanceController.cancel("Replaced by closed-loop driveDistance command.");
    this.navigationController.cancel("Replaced by closed-loop driveDistance command.");
    if (this.controlSource === "manual") {
      this.controlSource = "program";
    }
    const next = this.motionController.startDriveDistance({
      distanceMeters,
      model: this.differentialModel,
      odometry: this.odometryTracker.getState(),
      binding: this.binding,
      options,
    });
    if (!next.isActive) {
      this.target = NEUTRAL_NORMALIZED_TARGET;
    }
    return next;
  }

  turnToHeading(
    targetHeadingRadians: number,
    options?: ClosedLoopMotionOptions
  ): ClosedLoopMotionState {
    this.pausedNavigationByProgram = false;
    this.avoidanceController.cancel("Replaced by closed-loop turnToHeading command.");
    this.navigationController.cancel("Replaced by closed-loop turnToHeading command.");
    if (this.controlSource === "manual") {
      this.controlSource = "program";
    }
    const next = this.motionController.startTurnToHeading({
      targetHeadingRadians,
      model: this.differentialModel,
      odometry: this.odometryTracker.getState(),
      binding: this.binding,
      options,
    });
    if (!next.isActive) {
      this.target = NEUTRAL_NORMALIZED_TARGET;
    }
    return next;
  }

  turnByAngle(
    deltaHeadingRadians: number,
    options?: ClosedLoopMotionOptions
  ): ClosedLoopMotionState {
    this.pausedNavigationByProgram = false;
    this.avoidanceController.cancel("Replaced by closed-loop turnByAngle command.");
    this.navigationController.cancel("Replaced by closed-loop turnByAngle command.");
    if (this.controlSource === "manual") {
      this.controlSource = "program";
    }
    const next = this.motionController.startRelativeTurn({
      deltaHeadingRadians,
      model: this.differentialModel,
      odometry: this.odometryTracker.getState(),
      binding: this.binding,
      options,
    });
    if (!next.isActive) {
      this.target = NEUTRAL_NORMALIZED_TARGET;
    }
    return next;
  }

  cancelMotion(reason = "Motion cancelled."): ClosedLoopMotionState {
    this.pausedNavigationByProgram = false;
    this.avoidanceController.cancel(reason);
    this.navigationController.cancel(reason);
    const cancelled = this.motionController.cancel(reason);
    this.target = {
      ...NEUTRAL_NORMALIZED_TARGET,
      lastCommandAtSeconds: this.latestTimeSeconds,
      activeCommandKind: "stop-robot",
    };
    return cancelled;
  }

  dispatchCommand(command: RobotActuatorCommand): CommandNormalizationResult {
    if (command.kind !== "extensible-actuator") {
      this.pausedNavigationByProgram = false;
      this.avoidanceController.cancel("Cancelled by explicit actuator command.");
      this.navigationController.cancel(
        "Cancelled by explicit actuator command.",
        this.motionController
      );
      if (this.motionController.isActive()) {
        this.motionController.cancel("Cancelled by explicit actuator command.");
      }
    }
    const applied = applyCommandToDriveTarget({
      current: this.target,
      command,
      binding: this.binding,
      timestampSeconds: this.latestTimeSeconds,
      differentialModel: this.differentialModel,
      robotConfig: this.robotConfig,
    });
    this.target = applied.nextTarget;
    this.lastWarnings = applied.result.warnings;
    this.commandLogCount += 1;
    this.lastDifferentialResolution = applied.differentialResolution ?? null;
    return applied.result;
  }

  setTwistVelocity(
    linearVelocityMps: number,
    angularVelocityRadPerSec: number
  ): DifferentialDriveResolution {
    this.dispatchCommand({
      kind: "set-twist-velocity",
      linearVelocityMps,
      angularVelocityRadPerSec,
    });
    return this.lastDifferentialResolution!;
  }

  setNormalizedVelocity(
    linear: number,
    angular: number
  ): DifferentialDriveResolution {
    this.dispatchCommand({
      kind: "set-normalized-velocity",
      linear,
      angular,
    });
    return this.lastDifferentialResolution!;
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
            this.readSensorsSnapshot() ?? undefined,
            false,
            this.odometryTracker.getState(),
            this.motionController.getState(),
            this.navigationController.getState(),
            this.avoidanceController.getState()
          );
          this.routine.onTick(ctx, this);
        } catch (error) {
          this.handleFault(error);
        }
      }
    }

    if (
      this.controlSource !== "manual" &&
      this.programStatus !== "paused" &&
      this.programStatus !== "stopped" &&
      this.programStatus !== "fault" &&
      this.navigationController.isActive()
    ) {
      const odoState = this.odometryTracker.getState();
      const avoidanceStep = this.avoidanceController.step({
        dtSeconds,
        observations: this.readDistanceObservations(),
        odometry: odoState,
        headingErrorRadians: this.navigationController.getState().headingErrorRadians,
      });

      let navState: WaypointNavigationState;
      if (avoidanceStep.state.status === "blocked") {
        navState = this.navigationController.fail(
          avoidanceStep.state.failureReason ??
            "Obstacle avoidance could not find a clear path.",
          this.motionController
        );
      } else {
        navState = this.navigationController.step({
          dtSeconds,
          odometry: odoState,
          model: this.differentialModel,
          binding: this.binding,
          motionController: this.motionController,
          linearSpeedScale: avoidanceStep.linearSpeedScale,
          velocityOverride: avoidanceStep.velocityOverride,
        });
      }

      if (!navState.isActive) {
        if (navState.status === "completed") {
          this.avoidanceController.completeNavigation();
        } else if (navState.status === "failed" && avoidanceStep.state.status !== "blocked") {
          this.avoidanceController.cancel(
            navState.failureReason ?? "Navigation failed."
          );
        }
        this.lastWarnings = navState.warnings;
        this.target = {
          ...NEUTRAL_NORMALIZED_TARGET,
          lastCommandAtSeconds: this.latestTimeSeconds,
          activeCommandKind: "stop-robot",
        };
      }
    }

    if (
      this.controlSource !== "manual" &&
      this.programStatus !== "paused" &&
      this.programStatus !== "stopped" &&
      this.programStatus !== "fault" &&
      this.motionController.isActive()
    ) {
      const motionStep = this.motionController.step({
        dtSeconds,
        odometry: this.odometryTracker.getState(),
        model: this.differentialModel,
        binding: this.binding,
        robotConfig: this.robotConfig,
      });
      this.target = {
        leftPower: this.binding.canDrive ? motionStep.leftThrottle : 0,
        rightPower: this.binding.canDrive ? motionStep.rightThrottle : 0,
        lastCommandAtSeconds: this.latestTimeSeconds,
        activeCommandKind: motionStep.state.kind ?? "closed-loop-motion",
        clampedValues: Boolean(motionStep.state.lastResolution?.saturated),
      };
      this.lastWarnings = motionStep.state.warnings;
      if (motionStep.state.lastResolution) {
        this.lastDifferentialResolution = motionStep.state.lastResolution;
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
      motion: this.motionController.getState(),
      navigation: this.navigationController.getState(),
      avoidance: this.avoidanceController.getState(),
    };
  }

  private handleFault(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;
    this.programStatus = "fault";
    this.pausedTarget = null;
    this.pausedNavigationByProgram = false;
    this.avoidanceController.cancel(`Aborted due to runtime fault: ${message}`);
    this.navigationController.cancel(
      `Aborted due to runtime fault: ${message}`,
      this.motionController
    );
    this.motionController.cancel(`Aborted due to runtime fault: ${message}`);
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
