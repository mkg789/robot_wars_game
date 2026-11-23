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
    engineeringSpec: {
      category: "controller",
      controllerType: "microcontroller-board",
      processorArchitecture: "AVR (8-bit RISC)",
      clockSpeedHz: 16_000_000,
      electrical: {
        logicLevelV: 5.0,
        inputVoltageRangeV: {
          minV: 7.0,
          maxV: 12.0,
        },
        maxLogicRailCurrentA: 0.5,
        provenance: {
          method: "datasheet",
          verified: true,
          source: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
          notes:
            "Official Arduino Uno Rev3 recommended input voltage range 7-12V (limits 6-20V). 5V USB rail protected by 500mA PTC polyfuse (net external usable budget ~450mA after onboard draw). Under higher VIN (e.g. 12V), NCP1117 linear regulator thermally derates to ~150-250mA. Onboard 3.3V rail (LP2985) is limited to 50mA.",
        },
      },
      interfaces: {
        digitalIoPins: 14,
        pwmOutputs: 6,
        analogInputs: 6,
        supportedProtocols: ["uart", "spi", "i2c", "usb"],
      },
      mounting: {
        patternType: "face-mount",
        boltPattern: {
          boltSize: "M3",
          holeCount: 4,
        },
      },
      generalProvenance: {
        method: "datasheet",
        verified: true,
        source: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
        notes:
          "Arduino Uno Rev3 Reference Datasheet (A000066) & Microchip ATmega328P Datasheet. USB 500mA PTC polyfuse limits external usable current budget (~450mA after quiescent draw); VIN linear regulator thermally derates at higher input voltages; onboard 3.3V rail limited to ~50mA.",
      },
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
    engineeringSpec: {
      category: "controller",
      controllerType: "microcontroller-board",
      processorArchitecture: "Xtensa dual-core 32-bit LX6",
      clockSpeedHz: 240_000_000,
      electrical: {
        logicLevelV: 3.3,
        inputVoltageRangeV: {
          minV: 4.5,
          maxV: 5.5,
        },
        maxLogicRailCurrentA: 0.5,
        provenance: {
          method: "datasheet",
          verified: true,
          source: "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc.html",
          notes: "5V input via Micro-USB or 5V pin regulated to 3.3V via on-board LDO (typically 500mA capacity). Direct 3V3 pin supports 3.0-3.6V.",
        },
      },
      interfaces: {
        digitalIoPins: 28,
        pwmOutputs: 16,
        analogInputs: 16,
        supportedProtocols: ["wifi", "bluetooth", "uart", "spi", "i2c", "can", "pwm"],
      },
      generalProvenance: {
        method: "datasheet",
        verified: true,
        source: "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc.html",
        notes:
          "Espressif ESP32-DevKitC V4 Getting Started Guide & ESP32 Series Datasheet v4.4. 28 accessible GPIOs include 4 input-only pins (GPI 34, 35, 36, 39) and strapping pins (GPIO 0, 2, 5, 12, 15) with boot-related constraints. 16 accessible ADC channels broken out (ADC2 channels conflict with active Wi-Fi operation). CAN protocol supported via internal TWAI controller (requires external physical CAN transceiver). Preserves verified 16 PWM channel capability.",
      },
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
    engineeringSpec: {
      category: "controller",
      controllerType: "microcontroller-board",
      processorArchitecture: "Arm Cortex-M4 (32-bit with FPU)",
      clockSpeedHz: 84_000_000,
      electrical: {
        logicLevelV: 3.3,
        inputVoltageRangeV: {
          minV: 7.0,
          maxV: 12.0,
        },
        maxLogicRailCurrentA: 0.5,
        provenance: {
          method: "datasheet",
          verified: true,
          source: "https://www.st.com/resource/en/user_manual/um1724-stm32-nucleo64-boards-mb1136-stmicroelectronics.pdf",
          notes: "VIN external input range 7-12V recommended (6-15V limit) via on-board LDO regulator (LD39050PU33R / 500mA).",
        },
      },
      interfaces: {
        digitalIoPins: 50,
        pwmOutputs: 16,
        analogInputs: 16,
        supportedProtocols: ["uart", "spi", "i2c", "usb", "pwm"],
      },
      generalProvenance: {
        method: "datasheet",
        verified: true,
        source: "https://www.st.com/resource/en/user_manual/um1724-stm32-nucleo64-boards-mb1136-stmicroelectronics.pdf",
        notes:
          "STMicroelectronics UM1724 User Manual: STM32 Nucleo-64 boards (NUCLEO-F401RE) & STM32F401xD/xE Datasheet. Morpho headers expose full pin count (50 GPIOs, 16 ADC channels) while Arduino headers expose standard Arduino subset (16 GPIOs, 6 ADC channels). Onboard micro-USB connector (CN1) connects to ST-LINK debugger/virtual COM port; native MCU USB 2.0 FS OTG peripheral requires external physical breakout hardware on PA11/PA12.",
      },
    },
  },
];
