/**
 * Canonical engineering specification architecture for Robot Wars.
 *
 * Establishes typed engineering contracts for robotic components covering:
 * - Specification provenance at group and field levels
 * - Operational characteristics (motor torque/speed curves, battery C-ratings, controller I/O)
 * - Physical and mechanical coupling interfaces (shafts, hubs, bolt patterns)
 * - Discriminated union of component engineering specifications
 *
 * All physical quantities are represented strictly in SI base units:
 * - Length / displacement: meters (m)
 * - Mass: kilograms (kg)
 * - Potential difference: volts (V)
 * - Electric current: amperes (A)
 * - Electrical resistance: ohms (Ω)
 * - Torque: Newton-meters (N·m)
 * - Rotational velocity: revolutions per minute (RPM)
 * - Frequency: hertz (Hz)
 * - Force: Newtons (N)
 * - Pressure / stress: Pascals (Pa = N/m²)
 */

// ============================================================================
// 1. SPECIFICATION PROVENANCE & VERACITY
// ============================================================================

/**
 * Method or source by which an engineering specification was acquired.
 */
export type ProvenanceMethod =
  | "datasheet" // Directly extracted from manufacturer datasheet
  | "measured" // Empirically measured in physical bench testing or teardown
  | "estimated" // Calculated via physical formulas, heuristics, or developer estimation
  | "unknown"; // Unspecified, unavailable, or awaiting test

/**
 * Provenance descriptor detailing the veracity, citation, and verification status
 * of an engineering specification group or field.
 */
export type ProvenanceMeta = {
  readonly method: ProvenanceMethod;
  /** Whether the specification is verified against an authoritative source */
  readonly verified: boolean;
  /** Primary citation (datasheet URL, test report reference, etc.) */
  readonly source?: string;
  /** Technical rationale or formula used if method is 'estimated' */
  readonly basis?: string;
  /** Test conditions or qualification notes (e.g. 'at 25°C ambient, 12.0V rail') */
  readonly notes?: string;
};

/**
 * Field-level provenance map allowing distinct properties on the same component
 * to carry independent provenance records.
 */
export type FieldProvenanceMap<TKeys extends string = string> = {
  readonly [K in TKeys]?: ProvenanceMeta;
};

// ============================================================================
// 2. MECHANICAL INTERFACE CONTRACTS
// ============================================================================

/**
 * Geometric cross-sectional profile of a rotating drive or idler shaft.
 */
export type ShaftProfile =
  | "round"
  | "d-shaft"
  | "hex"
  | "spline"
  | "keyed"
  | "threaded";

/**
 * Mechanical interface specification for an output or idler shaft on a motor,
 * gearbox, or axle.
 */
export type ShaftInterface = {
  readonly identifier?: string;
  readonly profile: ShaftProfile;
  /** Shaft outer diameter in canonical meters (e.g. 0.004 for 4mm) */
  readonly diameterM: number;
  /** Usable axial shaft length in canonical meters */
  readonly lengthM: number;
  /** Flat depth in canonical meters for D-shafts (distance from outer diameter to flat surface) */
  readonly flatDepthM?: number;
  /** Keyway width in canonical meters for keyed shafts */
  readonly keywayWidthM?: number;
  /** Thread specification if threaded (e.g. 'M4x0.7', 'M5', '5/16-24') */
  readonly threadSpec?: string;
};

/**
 * Mechanical interface specification for a receiving bore/hub on a wheel, gear,
 * pulley, or coupling.
 */
export type HubInterface = {
  readonly identifier?: string;
  readonly profile: ShaftProfile;
  /** Inner bore diameter in canonical meters */
  readonly boreDiameterM: number;
  /** Axial engagement depth of the hub in canonical meters */
  readonly engagementDepthM: number;
  /** Hub retention or clamping mechanism */
  readonly retentionType?:
    | "set-screw"
    | "clamping"
    | "press-fit"
    | "nut"
    | "retaining-ring"
    | "pin";
  /** Fastener specification for retention (e.g. 'M3 set-screw') */
  readonly fastenerSpec?: string;
};

/**
 * Structural pattern for mounting components to chassis, bulkheads, or brackets.
 */
export type MountingPatternType =
  | "face-mount"
  | "foot-mount"
  | "flange-mount"
  | "bracket"
  | "clamp"
  | "plate-grid"
  | "custom";

/**
 * Bolt pattern layout and fastener dimensions.
 */
export type BoltPattern = {
  /** Fastener size / thread specification, e.g. 'M3', 'M4', '#6-32' */
  readonly boltSize: string;
  /** Number of bolt holes in the pattern */
  readonly holeCount: number;
  /** Bolt circle diameter (BCD) in canonical meters for circular/radial patterns */
  readonly boltCircleDiameterM?: number;
  /** Rectangular hole spacing [spacingX, spacingZ] in canonical meters */
  readonly rectangularSpacingM?: readonly [spacingX: number, spacingZ: number];
  /** Depth of tapped holes or max allowed thread engagement in meters */
  readonly maxThreadDepthM?: number;
};

/**
 * Mechanical mounting interface specification for attaching components structurally.
 */
export type MountingInterface = {
  readonly identifier?: string;
  readonly patternType: MountingPatternType;
  readonly boltPattern?: BoltPattern;
  /** Outer mounting footprint [length, height, width] in meters */
  readonly footprintDimensionsM?: readonly [number, number, number];
  /** Pilot boss / circular centering ring diameter in meters */
  readonly pilotDiameterM?: number;
};

// ============================================================================
// 3. MOTOR SPECIFICATIONS
// ============================================================================

export type MotorTechnology =
  | "brushed-dc"
  | "brushless-dc-sensored"
  | "brushless-dc-sensorless"
  | "stepper"
  | "coreless"
  | "servo";

/**
 * Electrical operating parameters for electric motors.
 * Stall, continuous, and no-load values are explicitly partitioned.
 */
export type MotorElectricalSpecs = {
  /** Nominal design voltage in canonical volts (V) */
  readonly nominalVoltageV: number;
  /** Minimum operating voltage in volts (V) */
  readonly minVoltageV?: number;
  /** Maximum safe operating voltage in volts (V) */
  readonly maxVoltageV?: number;
  /** Current draw at no-load / free-running in Amperes (A) */
  readonly noLoadCurrentA?: number;
  /** Continuous rated operating current under nominal load in Amperes (A) */
  readonly ratedCurrentA?: number;
  /** Stall current / peak starting current at nominal voltage in Amperes (A) */
  readonly stallCurrentA?: number;
  /** Terminal phase-to-phase winding resistance in Ohms (Ω) */
  readonly terminalResistanceOhm?: number;
  readonly provenance?: ProvenanceMeta;
};

/**
 * Mechanical and rotational output parameters for electric motors and gearmotors.
 * Stall, continuous, and no-load values are explicitly partitioned.
 */
export type MotorMechanicalSpecs = {
  /** Stall torque at the output shaft at nominal voltage in Newton-meters (N·m) */
  readonly stallTorqueNm: number;
  /** Continuous rated operating torque at output shaft in Newton-meters (N·m) */
  readonly ratedTorqueNm?: number;
  /** No-load angular velocity at output shaft in revolutions per minute (RPM) */
  readonly noLoadSpeedRpm: number;
  /** Rated operating speed under nominal load in revolutions per minute (RPM) */
  readonly ratedSpeedRpm?: number;
  /** Gearhead reduction ratio, output = motor / ratio (e.g. 20 for 20:1). Defaults to 1 for direct drive */
  readonly gearRatio?: number;
  /** Gearbox transmission efficiency (0.0 to 1.0, e.g. 0.85 for 85%) */
  readonly gearboxEfficiency?: number;
  readonly provenance?: ProvenanceMeta;
};

/**
 * Complete engineering specification for an electric motor component.
 */
export type MotorEngineeringSpec = {
  readonly category: "motor";
  readonly technology: MotorTechnology;
  readonly electrical: MotorElectricalSpecs;
  readonly mechanical: MotorMechanicalSpecs;
  readonly shaft: ShaftInterface;
  readonly mounting?: MountingInterface;
  readonly fieldProvenance?: FieldProvenanceMap;
  readonly generalProvenance?: ProvenanceMeta;
};

// ============================================================================
// 4. WHEEL SPECIFICATIONS
// ============================================================================

export type WheelTreadType =
  | "rubber"
  | "foam"
  | "polyurethane"
  | "pneumatic"
  | "omni-directional"
  | "mecanum"
  | "tread-belt"
  | "hard-plastic";

/**
 * Friction and contact characteristics of a wheel tire or tread.
 */
export type WheelTractionSpecs = {
  /** Static coefficient of friction against standard arena surface (e.g. steel/wood) */
  readonly staticFrictionCoeff?: number;
  /** Dynamic / kinetic coefficient of friction under slip conditions */
  readonly dynamicFrictionCoeff?: number;
  /** Maximum rated radial load in kilograms (kg) before de-beading or structural yield */
  readonly maxRadialLoadKg?: number;
  /** Tire durometer hardness rating, e.g. '40A', '60A' */
  readonly durometer?: string;
  readonly provenance?: ProvenanceMeta;
};

/**
 * Complete engineering specification for a wheel component.
 */
export type WheelEngineeringSpec = {
  readonly category: "wheel";
  readonly treadType: WheelTreadType;
  /** Mechanical hub interface for coupling to motor/axle shaft */
  readonly hub: HubInterface;
  readonly traction: WheelTractionSpecs;
  readonly fieldProvenance?: FieldProvenanceMap;
  readonly generalProvenance?: ProvenanceMeta;
};

// ============================================================================
// 5. BATTERY SPECIFICATIONS
// ============================================================================

export type BatteryChemistryType =
  | "lipo"
  | "lifepo4"
  | "li-ion"
  | "nimh"
  | "nicd"
  | "lead-acid";

export type BatteryConnectorType =
  | "xt30"
  | "xt60"
  | "xt90"
  | "deans-t"
  | "ec3"
  | "ec5"
  | "jst-rcy"
  | "screw-terminal"
  | "direct-solder";

/**
 * Electrical discharge and capacity specifications for battery packs.
 */
export type BatteryElectricalSpecs = {
  /** Nominal pack voltage in canonical volts (V) */
  readonly nominalVoltageV: number;
  /** Maximum safe fully charged voltage in volts (V) */
  readonly fullyChargedVoltageV?: number;
  /** Recommended minimum cutoff / discharge floor voltage in volts (V) */
  readonly cutoffVoltageV?: number;
  /** Stored electrical charge capacity in milliampere-hours (mAh) */
  readonly capacityMah: number;
  /** Continuous discharge C-rating (discharge Amps = capacityAh * continuousDischargeC) */
  readonly continuousDischargeC?: number;
  /** Burst / peak discharge C-rating (e.g. for 10-second burst bursts) */
  readonly burstDischargeC?: number;
  /** Total internal resistance of the pack in Ohms (Ω) */
  readonly internalResistanceOhm?: number;
  readonly provenance?: ProvenanceMeta;
};

/**
 * Complete engineering specification for a battery power source.
 */
export type BatteryEngineeringSpec = {
  readonly category: "battery";
  readonly chemistry: BatteryChemistryType;
  /** Number of series cells (e.g. 3 for 3S 11.1V LiPo pack) */
  readonly cellCountS?: number;
  /** Number of parallel cells (defaults to 1 for 1P) */
  readonly parallelCountP?: number;
  readonly electrical: BatteryElectricalSpecs;
  readonly connector?: {
    readonly type: BatteryConnectorType;
    readonly ratedCurrentA?: number;
  };
  readonly fieldProvenance?: FieldProvenanceMap;
  readonly generalProvenance?: ProvenanceMeta;
};

// ============================================================================
// 6. CONTROLLER SPECIFICATIONS
// ============================================================================

export type ControllerCategory =
  | "microcontroller-board"
  | "single-board-computer"
  | "motor-driver-esc"
  | "radio-receiver"
  | "power-distribution-board";

export type CommunicationProtocol =
  | "uart"
  | "spi"
  | "i2c"
  | "can"
  | "pwm"
  | "ppm"
  | "sbus"
  | "usb"
  | "wifi"
  | "bluetooth";

/**
 * Electrical power requirements and rail specifications for a controller board.
 */
export type ControllerElectricalSpecs = {
  /** Operating logic voltage level in volts (V) */
  readonly logicLevelV: 3.3 | 5.0 | 12.0;
  /** Acceptable input supply voltage range in volts (V) */
  readonly inputVoltageRangeV: {
    readonly minV: number;
    readonly maxV: number;
  };
  /** Idle operating current draw in Amperes (A) */
  readonly idleCurrentA?: number;
  /** Maximum total current capacity of the onboard regulated logic rail in Amperes (A) */
  readonly maxLogicRailCurrentA?: number;
  readonly provenance?: ProvenanceMeta;
};

/**
 * Hardware I/O pin counts and protocol capabilities.
 */
export type ControllerInterfacesSpecs = {
  readonly digitalIoPins?: number;
  readonly pwmOutputs?: number;
  readonly analogInputs?: number;
  readonly supportedProtocols?: readonly CommunicationProtocol[];
  readonly motorChannels?: number;
  readonly peakMotorCurrentPerChannelA?: number;
};

/**
 * Complete engineering specification for a microcontroller, computer, or controller board.
 */
export type ControllerEngineeringSpec = {
  readonly category: "controller";
  readonly controllerType: ControllerCategory;
  readonly processorArchitecture?: string;
  readonly clockSpeedHz?: number;
  readonly electrical: ControllerElectricalSpecs;
  readonly interfaces: ControllerInterfacesSpecs;
  readonly mounting?: MountingInterface;
  readonly fieldProvenance?: FieldProvenanceMap;
  readonly generalProvenance?: ProvenanceMeta;
};

// ============================================================================
// 7. STRUCTURAL SPECIFICATIONS
// ============================================================================

export type StructuralMaterialType =
  | "aluminum-6061-t6"
  | "aluminum-7075-t6"
  | "steel-mild"
  | "steel-hardox-450"
  | "titanium-grade-5"
  | "polycarbonate"
  | "uhmw-pe"
  | "carbon-fiber"
  | "pla-3d-print"
  | "petg-3d-print"
  | "nylon-cf";

/**
 * Material physical properties and structural strength ratings.
 */
export type StructuralMaterialSpecs = {
  readonly material: StructuralMaterialType;
  /** Material mass density in kg/m³ (e.g. 2700 for aluminum, 7850 for steel, 1200 for polycarbonate) */
  readonly densityKgM3?: number;
  /** Tensile yield strength in Pascals (N/m², e.g. 276e6 for 6061-T6 aluminum) */
  readonly yieldStrengthPa?: number;
  /** Ultimate tensile strength in Pascals (N/m²) */
  readonly ultimateStrengthPa?: number;
  /** Armor hardness rating (e.g. 'Brinell 450', 'Rockwell C45') */
  readonly hardness?: string;
  readonly provenance?: ProvenanceMeta;
};

/**
 * Complete engineering specification for a structural component (chassis, armor plate, cover, bumper).
 */
export type StructuralEngineeringSpec = {
  readonly category: "structural";
  readonly material: StructuralMaterialSpecs;
  /** Nominal plate or wall thickness in canonical meters (e.g. 0.003 for 3mm armor) */
  readonly plateThicknessM?: number;
  /** Structural role within the assembly */
  readonly role?:
    | "chassis-frame"
    | "armor-plate"
    | "bulkhead"
    | "protective-bumper"
    | "standoff";
  readonly mounting?: MountingInterface;
  readonly fieldProvenance?: FieldProvenanceMap;
  readonly generalProvenance?: ProvenanceMeta;
};

// ============================================================================
// 8. UNIFIED DISCRIMINATED UNION
// ============================================================================

/**
 * Discriminated union of all component engineering specifications in Robot Wars.
 * Discriminated by the 'category' property.
 */
export type ComponentEngineeringSpec =
  | MotorEngineeringSpec
  | WheelEngineeringSpec
  | BatteryEngineeringSpec
  | ControllerEngineeringSpec
  | StructuralEngineeringSpec;

/**
 * Supported engineering component categories.
 */
export type EngineeringComponentCategory = ComponentEngineeringSpec["category"];
