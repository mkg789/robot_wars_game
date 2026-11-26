export type SupportedSensorKind =
  | "ultrasonic"
  | "ir-proximity"
  | "line-sensor"
  | "imu"
  | "encoder"
  | "tof-distance"
  | "accelerometer"
  | "gyroscope"
  | "temperature";

export type SensorAvailabilityStatus =
  | "ready"
  | "unavailable-electrical-fault"
  | "unavailable-unpowered"
  | "unavailable-unsupported"
  | "not-installed";

export interface SensorDescriptor {
  readonly sensorId: string;
  readonly name: string;
  readonly sensorKind: SupportedSensorKind;
  readonly catalogueId?: string;
  /** Local offset relative to robot body center (+X forward, +Y up, +Z left) in meters */
  readonly localMountOffset: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  /** Sensor facing yaw offset relative to chassis +X forward direction in simulation heading radians (+CCW X->Z) */
  readonly mountYawOffsetRadians: number;
  readonly spanWidthMeters: number;
  readonly availability: SensorAvailabilityStatus;
  readonly availabilityReason?: string;
  readonly assumptions: readonly string[];
}

export interface UltrasonicDistanceData {
  readonly distanceMeters: number;
  readonly distanceCm: number;
  readonly inRange: boolean;
  readonly minRangeMeters: number;
  readonly maxRangeMeters: number;
  readonly hitBarrierId: string | null;
}

export interface IrProximityData {
  readonly detected: boolean;
  readonly distanceMeters: number | null;
  readonly thresholdMeters: number;
  readonly normalizedStrength: number;
  readonly hitBarrierId: string | null;
}

export interface LineSensorData {
  readonly detected: boolean;
  readonly surfaceId: string;
  readonly surfaceName: string;
  readonly channels: readonly boolean[];
  readonly lineOffsetNormalized: number | null;
}

export interface ImuData {
  readonly headingRadians: number;
  readonly headingDegrees: number;
  readonly yawRateRadPerSec: number;
  readonly yawRateDegPerSec: number;
  readonly longitudinalAccelerationMps2: number;
  readonly lateralAccelerationMps2: number;
  readonly angularAccelerationRadPerSec2: number;
}

export interface EncoderData {
  readonly side: "left" | "right" | "average";
  readonly ticks: number;
  readonly revolutions: number;
  readonly angularVelocityRadPerSec: number;
  readonly linearSpeedMps: number;
  readonly distanceMeters: number;
  readonly ticksPerRevolution: number;
}

export interface SensorReadResult<TData> {
  readonly ok: boolean;
  readonly status: SensorAvailabilityStatus;
  readonly sensorId: string | null;
  readonly sensorName: string | null;
  readonly sensorKind: SupportedSensorKind;
  readonly timestampSeconds: number;
  readonly reason?: string;
  readonly assumptions: readonly string[];
  readonly data: TData | null;
}

export interface EncoderAccumulatorState {
  readonly leftRadians: number;
  readonly rightRadians: number;
  readonly leftDistanceMeters: number;
  readonly rightDistanceMeters: number;
}

export interface RobotSensorsSnapshot {
  readonly installedSensors: readonly SensorDescriptor[];
  readonly ultrasonic: SensorReadResult<UltrasonicDistanceData>;
  readonly proximity: SensorReadResult<IrProximityData>;
  readonly lineSensor: SensorReadResult<LineSensorData>;
  readonly imu: SensorReadResult<ImuData>;
  readonly leftEncoder: SensorReadResult<EncoderData>;
  readonly rightEncoder: SensorReadResult<EncoderData>;
}
