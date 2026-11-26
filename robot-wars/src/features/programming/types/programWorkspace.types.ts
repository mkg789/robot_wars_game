export type InstructionCategory = "movement" | "sensor" | "logic";

export interface DriveInstruction {
  readonly id: string;
  readonly kind: "drive";
  readonly direction: "forward" | "backward";
  readonly power: number;
  readonly durationSeconds: number;
}

export interface TurnInstruction {
  readonly id: string;
  readonly kind: "turn";
  readonly direction: "left" | "right";
  readonly power: number;
  readonly durationSeconds: number;
}

export interface SetMotorsInstruction {
  readonly id: string;
  readonly kind: "set-motors";
  readonly leftPower: number;
  readonly rightPower: number;
}

export interface StopInstruction {
  readonly id: string;
  readonly kind: "stop";
  readonly target: "robot" | "both" | "left" | "right";
}

export interface WaitInstruction {
  readonly id: string;
  readonly kind: "wait";
  readonly durationSeconds: number;
}

export interface ReadUltrasonicInstruction {
  readonly id: string;
  readonly kind: "read-ultrasonic";
  readonly sensorId?: string;
}

export interface IfUltrasonicInstruction {
  readonly id: string;
  readonly kind: "if-ultrasonic";
  readonly operator: "below" | "above";
  readonly thresholdMeters: number;
  readonly sensorId?: string;
  readonly thenInstructions: readonly ProgramInstruction[];
  readonly elseInstructions: readonly ProgramInstruction[];
}

export interface RepeatInstruction {
  readonly id: string;
  readonly kind: "repeat";
  readonly count: number;
  readonly bodyInstructions: readonly ProgramInstruction[];
}

export type ProgramInstruction =
  | DriveInstruction
  | TurnInstruction
  | SetMotorsInstruction
  | StopInstruction
  | WaitInstruction
  | ReadUltrasonicInstruction
  | IfUltrasonicInstruction
  | RepeatInstruction;

export type ProgramInstructionKind = ProgramInstruction["kind"];

export interface VisualRobotProgram {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly updatedAtIso: string;
  readonly instructions: readonly ProgramInstruction[];
}

export interface ProgramValidationIssue {
  readonly severity: "error" | "warning";
  readonly instructionId?: string;
  readonly message: string;
}

export type ProgramTraceOutcome =
  | "active"
  | "completed"
  | "skipped"
  | "fault";

export type TraceSensorStatus = "normal" | "unavailable" | "error";

export interface ProgramTraceHistoryEntry {
  readonly id: string;
  readonly instructionId: string;
  readonly instructionKind: ProgramInstructionKind;
  readonly title: string;
  readonly paramsSummary: string;
  readonly outcome: ProgramTraceOutcome;
  readonly details: string;
  readonly timestampSeconds: number;
  readonly motorPower: {
    readonly left: number;
    readonly right: number;
  };
  readonly sensorValueSummary?: string;
  readonly sensorStatus?: TraceSensorStatus;
}

export interface VisualProgramExecutionTrace {
  readonly activeInstructionId: string | null;
  readonly completedInstructionIds: readonly string[];
  readonly skippedInstructionIds: readonly string[];
  readonly failedInstructionId: string | null;
  readonly repeatProgressById: Readonly<
    Record<string, { readonly currentIteration: number; readonly totalIterations: number }>
  >;
  readonly lastSensorSummary: string | null;
  readonly lastSensorStatus: TraceSensorStatus | null;
  readonly lastBranchOutcome: string | null;
  readonly statusMessage: string | null;
  readonly errorMessage: string | null;
  readonly history: readonly ProgramTraceHistoryEntry[];
}

export function getInstructionCategory(
  kind: ProgramInstructionKind
): InstructionCategory {
  switch (kind) {
    case "drive":
    case "turn":
    case "set-motors":
    case "stop":
      return "movement";
    case "read-ultrasonic":
      return "sensor";
    case "wait":
    case "if-ultrasonic":
    case "repeat":
      return "logic";
  }
}
