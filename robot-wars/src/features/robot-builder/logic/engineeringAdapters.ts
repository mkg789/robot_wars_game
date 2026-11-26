/**
 * Engineering specification resolver / adapter layer for Robot Wars.
 *
 * Resolves canonical component engineering specifications from runtime parts,
 * catalogue items, and legacy fallback properties according to a deterministic
 * precedence hierarchy:
 *
 * 1. Explicit runtime engineering specification (`part.engineeringSpec`)
 * 2. Catalogue engineering specification (`catalogueItem.engineeringSpec`)
 * 3. Adaptation of legacy properties (`part.electrical`, `part.mechanical`, `part.size`, catalogue specs)
 * 4. Unknown/unavailable representation (omitted / undefined, strictly avoiding fabricated numbers)
 *
 * All functions are pure, deterministic, and free of side effects.
 */

import type {
  RobotPart,
  MotorDefinition,
  WheelDefinition,
  BatteryDefinition,
  ControllerDefinition,
  ComponentEngineeringSpec,
  MotorEngineeringSpec,
  WheelEngineeringSpec,
  BatteryEngineeringSpec,
  ControllerEngineeringSpec,
  StructuralEngineeringSpec,
  ProvenanceMeta,
  FieldProvenanceMap,
  MotorElectricalSpecs,
  MotorMechanicalSpecs,
  BatteryElectricalSpecs,
  ControllerElectricalSpecs,
  ControllerInterfacesSpecs,
  StructuralMaterialSpecs,
  WheelTreadType,
  BatteryChemistryType,
  ControllerCategory,
} from "../types/robot.types";
import { type FoundationModel, foundationModels } from "../data/foundationModels";
import { motorCatalogue } from "../data/motorCatalogue";
import { wheelCatalogue } from "../data/wheelCatalogue";
import { batteryCatalogue } from "../data/batteryCatalogue";
import { controllerCatalogue } from "../data/controllerCatalogue";

/**
 * Resolves an electric motor engineering specification.
 *
 * Precedence:
 * 1. `part.engineeringSpec` (if category is motor)
 * 2. `catalogueMotor.engineeringSpec`
 * 3. Legacy properties from `part.mechanical`, `part.electrical`, `catalogueMotor.torque`, `catalogueMotor.rpm`
 * 4. Unspecified / undefined (never fabricated)
 */
export function resolveMotorEngineeringSpec(
  part: RobotPart,
  catalogueMotor?: MotorDefinition | null
): MotorEngineeringSpec {
  const catItem =
    catalogueMotor ??
    (part.motorCatalogueId
      ? motorCatalogue.find((m) => m.id === part.motorCatalogueId)
      : undefined);

  const runtimeSpec =
    part.engineeringSpec?.category === "motor" ? part.engineeringSpec : undefined;
  const catSpec = catItem?.engineeringSpec;

  // Electrical specs resolution (prefers runtime engineeringSpec, catalogue, legacy part.electrical, or attached electricalSpec.motorSpec)
  const elecMotorSpec = part.electricalSpec?.motorSpec;
  const nominalVoltageV =
    runtimeSpec?.electrical?.nominalVoltageV ??
    catSpec?.electrical?.nominalVoltageV ??
    part.electrical?.nominalVoltageV ??
    elecMotorSpec?.nominalVoltageV;

  const minVoltageV =
    runtimeSpec?.electrical?.minVoltageV ??
    catSpec?.electrical?.minVoltageV ??
    elecMotorSpec?.minVoltageV;
  const maxVoltageV =
    runtimeSpec?.electrical?.maxVoltageV ??
    catSpec?.electrical?.maxVoltageV ??
    elecMotorSpec?.maxVoltageV;
  const noLoadCurrentA =
    runtimeSpec?.electrical?.noLoadCurrentA ??
    catSpec?.electrical?.noLoadCurrentA ??
    elecMotorSpec?.noLoadCurrentA;
  const ratedCurrentA =
    runtimeSpec?.electrical?.ratedCurrentA ??
    catSpec?.electrical?.ratedCurrentA ??
    elecMotorSpec?.ratedCurrentA;
  const stallCurrentA =
    runtimeSpec?.electrical?.stallCurrentA ??
    catSpec?.electrical?.stallCurrentA ??
    elecMotorSpec?.stallCurrentA;
  const terminalResistanceOhm =
    runtimeSpec?.electrical?.terminalResistanceOhm ??
    catSpec?.electrical?.terminalResistanceOhm;

  const elecSpecProv: ProvenanceMeta | undefined =
    elecMotorSpec !== undefined && part.electricalSpec
      ? (() => {
          const p = part.electricalSpec.provenance;
          if (p.method === "datasheet") {
            return {
              method: "datasheet" as const,
              verified: "verified" in p ? Boolean(p.verified) : false,
              source: "source" in p && p.source ? p.source : "electricalSpec",
              ...(p.notes && { notes: p.notes }),
            };
          }
          if (p.method === "estimated") {
            return {
              method: "estimated" as const,
              basis:
                "basis" in p && p.basis
                  ? p.basis
                  : "Adapted from part.electricalSpec.motorSpec",
              ...(p.notes && { notes: p.notes }),
            };
          }
          if (p.method === "user-supplied") {
            return {
              method: "measured" as const,
              verified: false,
              source: "user-supplied",
              ...(p.notes && { notes: p.notes }),
            };
          }
          return {
            method: "unknown" as const,
            ...(p.notes && { notes: p.notes }),
          };
        })()
      : undefined;

  const electricalProvenance: ProvenanceMeta | undefined =
    runtimeSpec?.electrical?.provenance ??
    catSpec?.electrical?.provenance ??
    (part.electrical?.nominalVoltageV !== undefined
      ? { method: "datasheet", verified: false, source: "legacy:part.electrical" }
      : elecSpecProv);

  const hasElectrical =
    nominalVoltageV !== undefined ||
    minVoltageV !== undefined ||
    maxVoltageV !== undefined ||
    noLoadCurrentA !== undefined ||
    ratedCurrentA !== undefined ||
    stallCurrentA !== undefined ||
    terminalResistanceOhm !== undefined ||
    electricalProvenance !== undefined ||
    runtimeSpec?.electrical !== undefined ||
    catSpec?.electrical !== undefined;

  const electrical: MotorElectricalSpecs | undefined = hasElectrical
    ? {
        ...(nominalVoltageV !== undefined && { nominalVoltageV }),
        ...(minVoltageV !== undefined && { minVoltageV }),
        ...(maxVoltageV !== undefined && { maxVoltageV }),
        ...(noLoadCurrentA !== undefined && { noLoadCurrentA }),
        ...(ratedCurrentA !== undefined && { ratedCurrentA }),
        ...(stallCurrentA !== undefined && { stallCurrentA }),
        ...(terminalResistanceOhm !== undefined && { terminalResistanceOhm }),
        ...(electricalProvenance && { provenance: electricalProvenance }),
      }
    : undefined;

  // Mechanical specs resolution
  const stallTorqueNm =
    runtimeSpec?.mechanical?.stallTorqueNm ??
    catSpec?.mechanical?.stallTorqueNm ??
    part.mechanical?.stallTorqueNm ??
    catItem?.mechanical?.stallTorqueNm ??
    catItem?.torque;

  const noLoadSpeedRpm =
    runtimeSpec?.mechanical?.noLoadSpeedRpm ??
    catSpec?.mechanical?.noLoadSpeedRpm ??
    part.mechanical?.noLoadRpm ??
    catItem?.mechanical?.noLoadRpm ??
    catItem?.rpm;

  const ratedTorqueNm =
    runtimeSpec?.mechanical?.ratedTorqueNm ?? catSpec?.mechanical?.ratedTorqueNm;
  const ratedSpeedRpm =
    runtimeSpec?.mechanical?.ratedSpeedRpm ?? catSpec?.mechanical?.ratedSpeedRpm;
  const gearRatio =
    runtimeSpec?.mechanical?.gearRatio ?? catSpec?.mechanical?.gearRatio;
  const gearboxEfficiency =
    runtimeSpec?.mechanical?.gearboxEfficiency ??
    catSpec?.mechanical?.gearboxEfficiency;

  const mechanicalProvenance: ProvenanceMeta | undefined =
    runtimeSpec?.mechanical?.provenance ??
    catSpec?.mechanical?.provenance ??
    (stallTorqueNm !== undefined || noLoadSpeedRpm !== undefined
      ? {
          method: "datasheet",
          verified: false,
          source: catItem?.id ? `catalogue:motor:${catItem.id}` : "legacy:part.mechanical",
        }
      : undefined);

  const hasMechanical =
    stallTorqueNm !== undefined ||
    noLoadSpeedRpm !== undefined ||
    ratedTorqueNm !== undefined ||
    ratedSpeedRpm !== undefined ||
    gearRatio !== undefined ||
    gearboxEfficiency !== undefined ||
    mechanicalProvenance !== undefined ||
    runtimeSpec?.mechanical !== undefined ||
    catSpec?.mechanical !== undefined;

  const mechanical: MotorMechanicalSpecs | undefined = hasMechanical
    ? {
        ...(stallTorqueNm !== undefined && { stallTorqueNm }),
        ...(noLoadSpeedRpm !== undefined && { noLoadSpeedRpm }),
        ...(ratedTorqueNm !== undefined && { ratedTorqueNm }),
        ...(ratedSpeedRpm !== undefined && { ratedSpeedRpm }),
        ...(gearRatio !== undefined && { gearRatio }),
        ...(gearboxEfficiency !== undefined && { gearboxEfficiency }),
        ...(mechanicalProvenance && { provenance: mechanicalProvenance }),
      }
    : undefined;

  // Shaft interface resolution
  const shaft = runtimeSpec?.shaft ?? catSpec?.shaft;

  // Mounting interface resolution
  const mounting =
    runtimeSpec?.mounting ??
    catSpec?.mounting ??
    (catItem?.mountingFootprint
      ? {
          patternType: "face-mount" as const,
          footprintDimensionsM: [
            catItem.mountingFootprint[0],
            0,
            catItem.mountingFootprint[1],
          ] as const,
        }
      : undefined);

  // Field-level provenance resolution
  const fieldProvenance: FieldProvenanceMap | undefined =
    runtimeSpec?.fieldProvenance || catSpec?.fieldProvenance
      ? {
          ...(catSpec?.fieldProvenance ?? {}),
          ...(runtimeSpec?.fieldProvenance ?? {}),
        }
      : undefined;

  // General provenance resolution
  const generalProvenance: ProvenanceMeta =
    runtimeSpec?.generalProvenance ??
    catSpec?.generalProvenance ??
    (catItem
      ? {
          method: "datasheet",
          verified: false,
          source: `catalogue:motor:${catItem.id}`,
          notes: "Adapted from motor catalogue definition",
        }
      : part.mechanical || part.electrical
      ? {
          method: "datasheet",
          verified: false,
          source: "legacy:part-properties",
          notes: "Adapted from legacy runtime part fields",
        }
      : {
          method: "unknown",
          notes: "No authoritative or legacy motor specification available",
        });

  return {
    category: "motor",
    technology:
      runtimeSpec?.technology ??
      catSpec?.technology ??
      (catItem ? "brushed-dc" : undefined),
    ...(electrical && { electrical }),
    ...(mechanical && { mechanical }),
    ...(shaft && { shaft }),
    ...(mounting && { mounting }),
    ...(fieldProvenance && { fieldProvenance }),
    generalProvenance,
  };
}

/**
 * Resolves a wheel engineering specification.
 *
 * Precedence:
 * 1. `part.engineeringSpec` (if category is wheel)
 * 2. `catalogueWheel.engineeringSpec`
 * 3. Legacy properties from `catalogueWheel.category`, `part.wheelDiameter`, `part.wheelWidth`
 * 4. Unspecified / undefined (no fabricated friction or hub numbers)
 */
export function resolveWheelEngineeringSpec(
  part: RobotPart,
  catalogueWheel?: WheelDefinition | null
): WheelEngineeringSpec {
  const catItem =
    catalogueWheel ??
    (part.wheelCatalogueId
      ? wheelCatalogue.find((w) => w.id === part.wheelCatalogueId)
      : undefined);

  const runtimeSpec =
    part.engineeringSpec?.category === "wheel" ? part.engineeringSpec : undefined;
  const catSpec = catItem?.engineeringSpec;

  const mapCategoryToTread = (
    cat?: WheelDefinition["category"]
  ): WheelTreadType | undefined => {
    switch (cat) {
      case "Rubber":
        return "rubber";
      case "Heavy-duty":
        return "polyurethane";
      case "Grip":
        return "rubber";
      case "Omni":
        return "omni-directional";
      default:
        return undefined;
    }
  };

  const treadType =
    runtimeSpec?.treadType ??
    catSpec?.treadType ??
    mapCategoryToTread(catItem?.category);

  const hub = runtimeSpec?.hub ?? catSpec?.hub;

  const traction = runtimeSpec?.traction ?? catSpec?.traction;

  const fieldProvenance: FieldProvenanceMap | undefined =
    runtimeSpec?.fieldProvenance || catSpec?.fieldProvenance
      ? {
          ...(catSpec?.fieldProvenance ?? {}),
          ...(runtimeSpec?.fieldProvenance ?? {}),
        }
      : undefined;

  const generalProvenance: ProvenanceMeta =
    runtimeSpec?.generalProvenance ??
    catSpec?.generalProvenance ??
    (catItem
      ? {
          method: "datasheet",
          verified: false,
          source: `catalogue:wheel:${catItem.id}`,
          notes: "Adapted from wheel catalogue definition",
        }
      : {
          method: "unknown",
          notes: "No authoritative wheel specification available",
        });

  return {
    category: "wheel",
    ...(treadType && { treadType }),
    ...(hub && { hub }),
    ...(traction && { traction }),
    ...(fieldProvenance && { fieldProvenance }),
    generalProvenance,
  };
}

/**
 * Resolves a battery engineering specification.
 *
 * Precedence:
 * 1. `part.engineeringSpec` (if category is battery)
 * 2. `catalogueBattery.engineeringSpec`
 * 3. Legacy properties from `part.electrical`, `catalogueBattery.voltage`, `catalogueBattery.capacityMah`
 * 4. Unspecified / undefined (no fabricated C-ratings or resistance)
 */
export function resolveBatteryEngineeringSpec(
  part: RobotPart,
  catalogueBattery?: BatteryDefinition | null
): BatteryEngineeringSpec {
  const catItem =
    catalogueBattery ??
    (part.batteryCatalogueId
      ? batteryCatalogue.find((b) => b.id === part.batteryCatalogueId)
      : undefined);

  const runtimeSpec =
    part.engineeringSpec?.category === "battery" ? part.engineeringSpec : undefined;
  const catSpec = catItem?.engineeringSpec;

  const elecBatSpec = part.electricalSpec?.batterySpec;

  const chemistry: BatteryChemistryType | undefined =
    runtimeSpec?.chemistry ??
    catSpec?.chemistry ??
    (catItem?.chemistry === "LiPo" ? "lipo" : undefined);

  const nominalVoltageV =
    runtimeSpec?.electrical?.nominalVoltageV ??
    catSpec?.electrical?.nominalVoltageV ??
    part.electrical?.nominalVoltageV ??
    elecBatSpec?.nominalVoltageV ??
    catItem?.electrical?.nominalVoltageV ??
    catItem?.voltage;

  const capacityMah =
    runtimeSpec?.electrical?.capacityMah ??
    catSpec?.electrical?.capacityMah ??
    part.electrical?.capacityMah ??
    elecBatSpec?.capacityMah ??
    catItem?.electrical?.capacityMah ??
    catItem?.capacityMah;

  const fullyChargedVoltageV =
    runtimeSpec?.electrical?.fullyChargedVoltageV ??
    catSpec?.electrical?.fullyChargedVoltageV ??
    elecBatSpec?.maxVoltageV;

  const cutoffVoltageV =
    runtimeSpec?.electrical?.cutoffVoltageV ??
    catSpec?.electrical?.cutoffVoltageV ??
    elecBatSpec?.minOperatingVoltageV;

  const continuousDischargeC =
    runtimeSpec?.electrical?.continuousDischargeC ??
    catSpec?.electrical?.continuousDischargeC ??
    (elecBatSpec?.maxContinuousDischargeA !== undefined &&
    capacityMah !== undefined &&
    capacityMah > 0
      ? elecBatSpec.maxContinuousDischargeA / (capacityMah / 1000)
      : undefined);

  const burstDischargeC =
    runtimeSpec?.electrical?.burstDischargeC ??
    catSpec?.electrical?.burstDischargeC ??
    (elecBatSpec?.peakDischargeA !== undefined &&
    capacityMah !== undefined &&
    capacityMah > 0
      ? elecBatSpec.peakDischargeA / (capacityMah / 1000)
      : undefined);

  const internalResistanceOhm =
    runtimeSpec?.electrical?.internalResistanceOhm ??
    catSpec?.electrical?.internalResistanceOhm ??
    elecBatSpec?.internalResistanceOhm;

  const electricalProvenance: ProvenanceMeta | undefined =
    runtimeSpec?.electrical?.provenance ??
    catSpec?.electrical?.provenance ??
    (nominalVoltageV !== undefined || capacityMah !== undefined
      ? {
          method: "datasheet",
          verified: false,
          source: catItem?.id ? `catalogue:battery:${catItem.id}` : "legacy:part.electrical",
        }
      : undefined);

  const hasElectrical =
    nominalVoltageV !== undefined ||
    capacityMah !== undefined ||
    fullyChargedVoltageV !== undefined ||
    cutoffVoltageV !== undefined ||
    continuousDischargeC !== undefined ||
    burstDischargeC !== undefined ||
    internalResistanceOhm !== undefined ||
    electricalProvenance !== undefined ||
    runtimeSpec?.electrical !== undefined ||
    catSpec?.electrical !== undefined;

  const electrical: BatteryElectricalSpecs | undefined = hasElectrical
    ? {
        ...(nominalVoltageV !== undefined && { nominalVoltageV }),
        ...(capacityMah !== undefined && { capacityMah }),
        ...(fullyChargedVoltageV !== undefined && { fullyChargedVoltageV }),
        ...(cutoffVoltageV !== undefined && { cutoffVoltageV }),
        ...(continuousDischargeC !== undefined && { continuousDischargeC }),
        ...(burstDischargeC !== undefined && { burstDischargeC }),
        ...(internalResistanceOhm !== undefined && { internalResistanceOhm }),
        ...(electricalProvenance && { provenance: electricalProvenance }),
      }
    : undefined;

  // Infer cell count if LiPo chemistry and nominal voltage is known
  const inferCellCount = (): number | undefined => {
    if (nominalVoltageV === undefined) return undefined;
    if (chemistry === "lipo") {
      const cellCount = Math.round(nominalVoltageV / 3.7);
      if (Math.abs(nominalVoltageV - cellCount * 3.7) < 0.2) {
        return cellCount;
      }
    }
    return undefined;
  };

  const cellCountS =
    runtimeSpec?.cellCountS ?? catSpec?.cellCountS ?? inferCellCount();

  const parallelCountP =
    runtimeSpec?.parallelCountP ?? catSpec?.parallelCountP ?? (cellCountS ? 1 : undefined);

  const connector = runtimeSpec?.connector ?? catSpec?.connector;

  const fieldProvenance: FieldProvenanceMap | undefined =
    runtimeSpec?.fieldProvenance || catSpec?.fieldProvenance
      ? {
          ...(catSpec?.fieldProvenance ?? {}),
          ...(runtimeSpec?.fieldProvenance ?? {}),
        }
      : undefined;

  const generalProvenance: ProvenanceMeta =
    runtimeSpec?.generalProvenance ??
    catSpec?.generalProvenance ??
    (catItem
      ? {
          method: "datasheet",
          verified: false,
          source: `catalogue:battery:${catItem.id}`,
          notes: "Adapted from battery catalogue definition",
        }
      : part.electrical
      ? {
          method: "datasheet",
          verified: false,
          source: "legacy:part.electrical",
          notes: "Adapted from legacy runtime part electrical specifications",
        }
      : {
          method: "unknown",
          notes: "No authoritative battery specification available",
        });

  return {
    category: "battery",
    ...(chemistry && { chemistry }),
    ...(cellCountS !== undefined && { cellCountS }),
    ...(parallelCountP !== undefined && { parallelCountP }),
    ...(electrical && { electrical }),
    ...(connector && { connector }),
    ...(fieldProvenance && { fieldProvenance }),
    generalProvenance,
  };
}

/**
 * Resolves a controller / compute engineering specification.
 *
 * Precedence:
 * 1. `part.engineeringSpec` (if category is controller)
 * 2. `catalogueController.engineeringSpec`
 * 3. Legacy properties from `catalogueController.processor`, `catalogueController.clockMHz`, `catalogueController.operatingVoltage`
 * 4. Unspecified / undefined
 */
export function resolveControllerEngineeringSpec(
  part: RobotPart,
  catalogueController?: ControllerDefinition | null
): ControllerEngineeringSpec {
  const catItem =
    catalogueController ??
    (part.controllerCatalogueId
      ? controllerCatalogue.find((c) => c.id === part.controllerCatalogueId)
      : undefined);

  const runtimeSpec =
    part.engineeringSpec?.category === "controller"
      ? part.engineeringSpec
      : undefined;
  const catSpec = catItem?.engineeringSpec;

  const mapControllerType = (
    legacyType?: ControllerDefinition["controllerType"]
  ): ControllerCategory | undefined => {
    switch (legacyType) {
      case "Microcontroller board":
      case "Wireless development board":
      case "Development board":
        return "microcontroller-board";
      default:
        return undefined;
    }
  };

  const controllerType =
    runtimeSpec?.controllerType ??
    catSpec?.controllerType ??
    mapControllerType(catItem?.controllerType);

  const processorArchitecture =
    runtimeSpec?.processorArchitecture ??
    catSpec?.processorArchitecture ??
    catItem?.processor;

  const clockSpeedHz =
    runtimeSpec?.clockSpeedHz ??
    catSpec?.clockSpeedHz ??
    (catItem?.clockMHz ? catItem.clockMHz * 1_000_000 : undefined);

  // Parse logic voltage
  const parseLogicLevel = (): 3.3 | 5.0 | 12.0 | undefined => {
    if (runtimeSpec?.electrical?.logicLevelV !== undefined) {
      return runtimeSpec.electrical.logicLevelV;
    }
    if (catSpec?.electrical?.logicLevelV !== undefined) {
      return catSpec.electrical.logicLevelV;
    }
    const legacyVoltStr = catItem?.operatingVoltage;
    if (legacyVoltStr === "5V" || legacyVoltStr === "5.0V") return 5.0;
    if (legacyVoltStr === "3.3V") return 3.3;
    if (legacyVoltStr === "12V") return 12.0;

    const legacyNominal = part.electrical?.nominalVoltageV;
    if (legacyNominal === 5) return 5.0;
    if (legacyNominal === 3.3) return 3.3;
    if (legacyNominal === 12) return 12.0;

    return undefined;
  };

  const logicLevelV = parseLogicLevel();
  const inputVoltageRangeV =
    runtimeSpec?.electrical?.inputVoltageRangeV ??
    catSpec?.electrical?.inputVoltageRangeV;
  const idleCurrentA =
    runtimeSpec?.electrical?.idleCurrentA ?? catSpec?.electrical?.idleCurrentA;
  const maxLogicRailCurrentA =
    runtimeSpec?.electrical?.maxLogicRailCurrentA ??
    catSpec?.electrical?.maxLogicRailCurrentA;

  const electricalProvenance: ProvenanceMeta | undefined =
    runtimeSpec?.electrical?.provenance ??
    catSpec?.electrical?.provenance ??
    (logicLevelV !== undefined
      ? {
          method: "datasheet",
          verified: false,
          source: catItem?.id
            ? `catalogue:controller:${catItem.id}`
            : "legacy:controller.operatingVoltage",
        }
      : undefined);

  const hasElectrical =
    logicLevelV !== undefined ||
    inputVoltageRangeV !== undefined ||
    idleCurrentA !== undefined ||
    maxLogicRailCurrentA !== undefined ||
    electricalProvenance !== undefined ||
    runtimeSpec?.electrical !== undefined ||
    catSpec?.electrical !== undefined;

  const electrical: ControllerElectricalSpecs | undefined = hasElectrical
    ? {
        ...(logicLevelV !== undefined && { logicLevelV }),
        ...(inputVoltageRangeV && { inputVoltageRangeV }),
        ...(idleCurrentA !== undefined && { idleCurrentA }),
        ...(maxLogicRailCurrentA !== undefined && { maxLogicRailCurrentA }),
        ...(electricalProvenance && { provenance: electricalProvenance }),
      }
    : undefined;

  const interfaces: ControllerInterfacesSpecs | undefined =
    runtimeSpec?.interfaces ?? catSpec?.interfaces ?? {};

  const mounting = runtimeSpec?.mounting ?? catSpec?.mounting;

  const fieldProvenance: FieldProvenanceMap | undefined =
    runtimeSpec?.fieldProvenance || catSpec?.fieldProvenance
      ? {
          ...(catSpec?.fieldProvenance ?? {}),
          ...(runtimeSpec?.fieldProvenance ?? {}),
        }
      : undefined;

  const generalProvenance: ProvenanceMeta =
    runtimeSpec?.generalProvenance ??
    catSpec?.generalProvenance ??
    (catItem
      ? {
          method: "datasheet",
          verified: false,
          source: `catalogue:controller:${catItem.id}`,
          notes: "Adapted from controller catalogue definition",
        }
      : {
          method: "unknown",
          notes: "No authoritative controller specification available",
        });

  return {
    category: "controller",
    ...(controllerType && { controllerType }),
    ...(processorArchitecture && { processorArchitecture }),
    ...(clockSpeedHz !== undefined && { clockSpeedHz }),
    ...(electrical && { electrical }),
    ...(interfaces && { interfaces }),
    ...(mounting && { mounting }),
    ...(fieldProvenance && { fieldProvenance }),
    generalProvenance,
  };
}

/**
 * Resolves a structural / armor / chassis engineering specification.
 *
 * Precedence:
 * 1. `part.engineeringSpec` (if category is structural)
 * 2. `catalogueStructural.engineeringSpec`
 * 3. Legacy properties derived from `part.type`, `part.geometry`, `part.size`
 * 4. Unspecified / undefined (no fabricated material density or yield strength)
 */
export function resolveStructuralEngineeringSpec(
  part: RobotPart,
  catalogueStructural?: FoundationModel | null
): StructuralEngineeringSpec {
  const catItem =
    catalogueStructural ??
    foundationModels.find(
      (f) =>
        (part.foundationModelId && f.id === part.foundationModelId) ||
        f.id === part.id ||
        f.name.toLowerCase() === part.name.toLowerCase()
    );

  const runtimeSpec =
    part.engineeringSpec?.category === "structural"
      ? part.engineeringSpec
      : undefined;
  const catSpec = catItem?.engineeringSpec;

  const inferRole = (): StructuralEngineeringSpec["role"] => {
    if (runtimeSpec?.role) return runtimeSpec.role;
    if (catSpec?.role) return catSpec.role;
    switch (part.type) {
      case "Armor Plate":
        return "armor-plate";
      case "Structural Block":
        return "chassis-frame";
      case "Front Bumper":
        return "protective-bumper";
      default:
        return undefined;
    }
  };

  const role = inferRole();

  const material: StructuralMaterialSpecs | undefined =
    runtimeSpec?.material ?? catSpec?.material;

  // Infer nominal plate thickness for armor plates from smallest box dimension
  const inferPlateThickness = (): number | undefined => {
    if (runtimeSpec?.plateThicknessM !== undefined) {
      return runtimeSpec.plateThicknessM;
    }
    if (catSpec?.plateThicknessM !== undefined) {
      return catSpec.plateThicknessM;
    }
    if (part.type === "Armor Plate") {
      if (part.geometry?.shape === "box") {
        return Math.min(
          part.geometry.length,
          part.geometry.height,
          part.geometry.width
        );
      }
      if (part.size) {
        return Math.min(part.size[0], part.size[1], part.size[2]);
      }
    }
    return undefined;
  };

  const plateThicknessM = inferPlateThickness();

  const mounting = runtimeSpec?.mounting ?? catSpec?.mounting;

  const fieldProvenance: FieldProvenanceMap | undefined =
    runtimeSpec?.fieldProvenance || catSpec?.fieldProvenance
      ? {
          ...(catSpec?.fieldProvenance ?? {}),
          ...(runtimeSpec?.fieldProvenance ?? {}),
        }
      : undefined;

  const generalProvenance: ProvenanceMeta =
    runtimeSpec?.generalProvenance ??
    catSpec?.generalProvenance ??
    (part.type === "Armor Plate" ||
    part.type === "Structural Block" ||
    part.type === "Front Bumper"
      ? {
          method: "estimated",
          basis: "Inferred from structural component type and geometry extents",
          notes: "Material properties remain unassigned until explicitly specified",
        }
      : {
          method: "unknown",
          notes: "No structural engineering data available",
        });

  return {
    category: "structural",
    ...(role && { role }),
    ...(material && { material }),
    ...(plateThicknessM !== undefined && { plateThicknessM }),
    ...(mounting && { mounting }),
    ...(fieldProvenance && { fieldProvenance }),
    generalProvenance,
  };
}

/**
 * Universal component engineering specification resolver.
 *
 * Resolves canonical engineering specifications for any runtime RobotPart
 * by inspecting its `engineeringSpec`, `type`, catalogue identifiers, and legacy fields.
 *
 * Precedence hierarchy (deterministic):
 * 1. Explicit runtime engineering specification (`part.engineeringSpec`)
 * 2. Catalogue engineering specification (`catalogueItem.engineeringSpec`)
 * 3. Legacy property adaptation (`part.electrical`, `part.mechanical`, `part.size`, catalogue specs)
 * 4. Unknown/unavailable representation (omitted / undefined, strictly avoiding fabricated numbers)
 *
 * Returns `undefined` if the component type or category cannot be resolved.
 */
export function resolveComponentEngineeringSpec(
  part: RobotPart,
  catalogueItem?:
    | MotorDefinition
    | WheelDefinition
    | BatteryDefinition
    | ControllerDefinition
    | FoundationModel
    | null
): ComponentEngineeringSpec | undefined {
  // Determine target category from runtime specification first, then from part type
  const targetCategory =
    part.engineeringSpec?.category ?? mapPartTypeToCategory(part.type);

  switch (targetCategory) {
    case "motor":
      return resolveMotorEngineeringSpec(
        part,
        catalogueItem as MotorDefinition | null | undefined
      );

    case "wheel":
      return resolveWheelEngineeringSpec(
        part,
        catalogueItem as WheelDefinition | null | undefined
      );

    case "battery":
      return resolveBatteryEngineeringSpec(
        part,
        catalogueItem as BatteryDefinition | null | undefined
      );

    case "controller":
      return resolveControllerEngineeringSpec(
        part,
        catalogueItem as ControllerDefinition | null | undefined
      );

    case "structural":
      return resolveStructuralEngineeringSpec(
        part,
        catalogueItem as FoundationModel | null | undefined
      );

    default:
      return undefined;
  }
}

/**
 * Maps runtime `ComponentType` to its canonical `EngineeringComponentCategory`.
 */
function mapPartTypeToCategory(
  type: RobotPart["type"]
): ComponentEngineeringSpec["category"] | undefined {
  switch (type) {
    case "Motor":
      return "motor";
    case "Wheel":
      return "wheel";
    case "Battery":
      return "battery";
    case "Controller":
      return "controller";
    case "Armor Plate":
    case "Structural Block":
    case "Front Bumper":
      return "structural";
    default:
      return undefined;
  }
}
