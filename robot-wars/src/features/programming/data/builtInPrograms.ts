import type { RobotControlRoutine } from "../types/control.types";

/**
 * Deterministic foundational routines demonstrating the typed RobotControlApi
 * driving the existing differential-drive SimulationRunner physics pipeline.
 */
export const BUILTIN_CONTROL_ROUTINES: readonly RobotControlRoutine[] = [
  {
    id: "program-forward-pulse",
    name: "Forward Pulse (2.5s)",
    description:
      "Applies +0.65 power to both drive channels for 2.5 seconds, then halts cleanly via stopRobot().",
    onTick: (ctx, api) => {
      if (ctx.timeSeconds < 2.5) {
        api.setMotorPower("both", 0.65);
      } else {
        api.completeProgram();
      }
    },
  },
  {
    id: "program-timed-turn",
    name: "Drive & Differential Turn",
    description:
      "Drives forward (0–1.5s), pivots clockwise (1.5–2.6s), drives forward again (2.6–3.8s), then stops.",
    onTick: (ctx, api) => {
      if (ctx.timeSeconds < 1.5) {
        api.setDifferentialPower(0.6, 0.6);
      } else if (ctx.timeSeconds < 2.6) {
        api.setDifferentialPower(0.5, -0.5);
      } else if (ctx.timeSeconds < 3.8) {
        api.setDifferentialPower(0.6, 0.6);
      } else {
        api.completeProgram();
      }
    },
  },
  {
    id: "program-reverse-pulse",
    name: "Reverse Safety Check (1.8s)",
    description:
      "Tests reverse motor polarity at -0.45 power for 1.8 seconds before issuing stopMotors().",
    onTick: (ctx, api) => {
      if (ctx.timeSeconds < 1.8) {
        api.setLeftMotorPower(-0.45);
        api.setRightMotorPower(-0.45);
      } else {
        api.stopMotors("both");
        api.completeProgram();
      }
    },
  },
  {
    id: "program-ultrasonic-guard",
    name: "Obstacle Guard (Ultrasonic / IR)",
    description:
      "Drives forward while clear and stops automatically if an installed Ultrasonic or IR sensor detects an obstacle within 0.8m.",
    onTick: (_ctx, api) => {
      const sonar = api.readUltrasonic();
      if (sonar.ok && sonar.data && sonar.data.inRange && sonar.data.distanceMeters < 0.8) {
        api.stopRobot();
        api.completeProgram();
        return;
      }
      const ir = api.readProximity();
      if (ir.ok && ir.data?.detected) {
        api.stopRobot();
        api.completeProgram();
        return;
      }
      api.setMotorPower("both", 0.55);
    },
  },
];
