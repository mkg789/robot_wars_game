/**
 * Canonical data contracts for the Phase 4.2 Simulation World orchestration layer.
 *
 * Bridges the pure deterministic simulation engine with the interactive frontend viewport,
 * lifecycle controls, keyboard/UI drive inputs, and read-only telemetry snapshots
 * without embedding physics in React or Three.js.
 */

import type { ElectricalConnection } from "../../electrical/types/electrical.types";
import type { RobotProgramControllerState } from "../../programming/types/control.types";
import type { RobotPart } from "../../robot-builder/types/robot.types";
import type { ArenaConfig } from "./arena.types";
import type { CollisionResponseOptions, DrivetrainInput, SimulationRobotConfig, SimulationRunnerOptions, SimulationRunnerState } from "./simulation.types";

import type {
  SimulationDriveControls,
  SimulationLifecycleStatus,
  SimulationTelemetrySnapshot,
} from "./simulationTelemetry.types";

export * from "./simulationTelemetry.types";

/**
 * Named arena preset available for selection in the simulation world.
 */
export interface SimulationArenaPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly arena: ArenaConfig;
}

/**
 * Initialization options for constructing a SimulationWorld instance.
 */
export interface SimulationWorldOptions {
  readonly robotConfig: SimulationRobotConfig;
  readonly arena: ArenaConfig;
  readonly parts?: readonly RobotPart[];
  readonly electricalConnections?: readonly ElectricalConnection[];
  readonly initialPose?: {
    readonly x?: number;
    readonly z?: number;
    readonly heading?: number;
  };
  readonly collisionResponse?: CollisionResponseOptions;
  readonly runnerOptions?: Omit<SimulationRunnerOptions, "arena" | "collisionResponse">;
  readonly maxFrameDeltaSeconds?: number;
}

/**
 * Result returned by SimulationWorld factory helpers when compiling from assembly data.
 */
export interface SimulationWorldInitResult<TWorld = unknown> {
  readonly success: boolean;
  readonly world: TWorld | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Snapshot of runner and world state exposed for inspection and testing.
 */
export interface SimulationWorldDiagnostics {
  readonly lifecycleStatus: SimulationLifecycleStatus;
  readonly activeControls: SimulationDriveControls;
  readonly activeInput: DrivetrainInput;
  readonly runnerState: SimulationRunnerState;
  readonly telemetry: SimulationTelemetrySnapshot;
  readonly controlState: RobotProgramControllerState;
}
