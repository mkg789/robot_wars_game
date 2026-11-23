import type { ControllerDefinition } from "../types/robot.types";

export const controllerCatalogue: ControllerDefinition[] = [
  {
    id: "arduino-uno",
    name: "Arduino Uno",
    controllerType: "Microcontroller board",
    dimensions: { length: 0.069, width: 0.054, height: 0.015 },
    weight: 0.025,
    color: "#177e89",
    processor: "ATmega328P",
    clockMHz: 16,
    operatingVoltage: "5V",
    geometry: {
      shape: "box",
      length: 0.069,
      height: 0.015,
      width: 0.054,
    },
    massKg: 0.025,
    electrical: {
      nominalVoltageV: 5.0,
    },
  },
  {
    id: "esp32-devkit",
    name: "ESP32 DevKit",
    controllerType: "Wireless development board",
    dimensions: { length: 0.055, width: 0.028, height: 0.01 },
    weight: 0.009,
    color: "#263746",
    processor: "ESP32",
    clockMHz: 240,
    operatingVoltage: "3.3V",
    geometry: {
      shape: "box",
      length: 0.055,
      height: 0.01,
      width: 0.028,
    },
    massKg: 0.009,
    electrical: {
      nominalVoltageV: 3.3,
    },
  },
  {
    id: "stm32-nucleo",
    name: "STM32 Nucleo",
    controllerType: "Development board",
    dimensions: { length: 0.07, width: 0.053, height: 0.014 },
    weight: 0.025,
    color: "#2563eb",
    processor: "STM32F401RE",
    clockMHz: 84,
    operatingVoltage: "3.3V",
    geometry: {
      shape: "box",
      length: 0.07,
      height: 0.014,
      width: 0.053,
    },
    massKg: 0.025,
    electrical: {
      nominalVoltageV: 3.3,
    },
  },
];
