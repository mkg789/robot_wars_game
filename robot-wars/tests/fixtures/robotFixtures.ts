import { resolvePartElectricalSpec } from "../../src/features/electrical/logic/electricalComponentAdapters";
import { saveVisualProgram } from "../../src/features/programming/logic/programPersistence";
import type { VisualRobotProgram } from "../../src/features/programming/types/programWorkspace.types";
import { buildCustomCollisionConfig, resolveImportedEngineeringProperties } from "../../src/features/robot-builder/logic/customCollision";
import { registerParsedStlAsset } from "../../src/features/robot-builder/logic/meshAssetRegistry";
import {
  buildBinaryStlBuffer,
  parseStlArrayBuffer,
} from "../../src/features/robot-builder/logic/stlParser";
import type {
  CustomCollisionConfig,
  ImportedEngineeringProperties,
  ImportedMeshTransform,
  MeshAssetInspection,
} from "../../src/features/robot-builder/types/foundation.types";
import type { DrivetrainType } from "../../src/features/robot-builder/types/robot.types";
import { useRobotStore } from "../../src/store/robotStore";

export interface StlFixturePayload {
  readonly buffer: ArrayBuffer;
  readonly assetId: string;
  readonly fileName: string;
  readonly inspection: MeshAssetInspection;
  readonly transform: ImportedMeshTransform;
  readonly engineering: ImportedEngineeringProperties;
  readonly collision: CustomCollisionConfig;
}

export interface AssembledRobotFixtureIds {
  readonly batteryId: string;
  readonly controllerId: string;
  readonly leftMotorId: string;
  readonly rightMotorId: string;
  readonly leftWheelId: string;
  readonly rightWheelId: string;
  readonly structuralPartId?: string;
  readonly ultrasonicPartId?: string;
}

export function createWatertightBoxTriangles(
  lx = 400,
  hy = 120,
  wz = 300,
  offset: readonly [number, number, number] = [0, 0, 0]
) {
  const hx = lx / 2;
  const hy2 = hy / 2;
  const hz = wz / 2;
  const [ox, oy, oz] = offset;
  const p = [
    [-hx + ox, -hy2 + oy, -hz + oz],
    [hx + ox, -hy2 + oy, -hz + oz],
    [hx + ox, hy2 + oy, -hz + oz],
    [-hx + ox, hy2 + oy, -hz + oz],
    [-hx + ox, -hy2 + oy, hz + oz],
    [hx + ox, -hy2 + oy, hz + oz],
    [hx + ox, hy2 + oy, hz + oz],
    [-hx + ox, hy2 + oy, hz + oz],
  ] as const;

  return [
    [p[0], p[2], p[1]],
    [p[0], p[3], p[2]],
    [p[4], p[5], p[6]],
    [p[4], p[6], p[7]],
    [p[0], p[1], p[5]],
    [p[0], p[5], p[4]],
    [p[3], p[7], p[6]],
    [p[3], p[6], p[2]],
    [p[0], p[4], p[7]],
    [p[0], p[7], p[3]],
    [p[1], p[2], p[6]],
    [p[1], p[6], p[5]],
  ] as const;
}

export function registerStlBoxFixture(options?: {
  fileName?: string;
  dimensionsRaw?: readonly [number, number, number];
  unit?: "mm" | "cm" | "m";
  orientationRotation?: readonly [number, number, number];
  collisionMode?: "single-box" | "multi-box";
}): StlFixturePayload {
  const [lx, hy, wz] = options?.dimensionsRaw ?? [400, 120, 300];
  const fileName = options?.fileName ?? "fixture-box.stl";
  const buffer = buildBinaryStlBuffer(createWatertightBoxTriangles(lx, hy, wz));
  const parsed = parseStlArrayBuffer(buffer, fileName);
  const rec = registerParsedStlAsset(parsed);

  const transform: ImportedMeshTransform = {
    unit: options?.unit ?? "mm",
    unitConfirmed: true,
    scaleMode: "uniform",
    uniformScale: 1,
    nonUniformScale: [1, 1, 1],
    orientationRotation: options?.orientationRotation ?? [0, 0, 0],
    positionOffset: [0, 0, 0],
  };

  const engineering = resolveImportedEngineeringProperties({
    inspection: parsed.inspection,
    transform,
    materialId: "aluminum-6061",
    massMode: "estimated-density",
    centerOfMassMode: "calculated",
    inertiaMode: "calculated",
  });

  const scaleToM = transform.unit === "mm" ? 0.001 : transform.unit === "cm" ? 0.01 : 1;
  const extents: [number, number, number] = [
    Math.max(0.02, lx * scaleToM),
    Math.max(0.02, hy * scaleToM),
    Math.max(0.02, wz * scaleToM),
  ];

  const collision = buildCustomCollisionConfig({
    mode: options?.collisionMode ?? "single-box",
    extents,
    assetId: rec.assetId,
  });

  return {
    buffer,
    assetId: rec.assetId,
    fileName,
    inspection: parsed.inspection,
    transform,
    engineering,
    collision,
  };
}

export function wireCommonGroundFixture(
  partIds: readonly string[],
  groundRefPartId: string
): void {
  const store = useRobotStore.getState();
  const refPart = store.parts.find((part) => part.id === groundRefPartId);
  const refGnd =
    (refPart ? resolvePartElectricalSpec(refPart)?.interfaces : undefined)?.find(
      (iface) => iface.role === "ground"
    )?.interfaceId ?? "bat-gnd";

  for (const partId of partIds) {
    if (partId === groundRefPartId) continue;
    const part = useRobotStore.getState().parts.find((item) => item.id === partId);
    const partGnd =
      (part ? resolvePartElectricalSpec(part)?.interfaces : undefined)?.find(
        (iface) => iface.role === "ground"
      )?.interfaceId ?? "bat-gnd";

    useRobotStore.getState().addElectricalConnection({
      sourcePartId: partId,
      sourceInterfaceId: partGnd,
      targetPartId: groundRefPartId,
      targetInterfaceId: refGnd,
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });
  }
}

export function assembleConfiguredRobotFixture(options?: {
  projectName?: string;
  drivetrainType?: DrivetrainType;
  addStructuralPart?: boolean;
  addUltrasonic?: boolean;
  wireEscAndMotors?: boolean;
  savedProgram?: VisualRobotProgram;
}): AssembledRobotFixtureIds {
  const store = useRobotStore.getState();
  store.startNewBuild();
  store.setProjectName(options?.projectName ?? "Integration Fixture Bot");
  store.confirmFoundation();

  const structuralPartId = options?.addStructuralPart
    ? useRobotStore.getState().addStructuralPart("flat-plate") ?? undefined
    : undefined;

  useRobotStore.getState().installBattery("standard-lipo");
  useRobotStore.getState().installController("arduino-uno");

  const zones =
    options?.drivetrainType === "differential-4"
      ? ["front-left", "front-right", "rear-left", "rear-right"]
      : ["front-left", "front-right"];

  if (options?.drivetrainType === "differential-4") {
    useRobotStore.getState().setDrivetrainType("differential-4", true);
  }

  for (const zoneId of zones) {
    useRobotStore.getState().selectMotorCatalogueItem("standard-dc");
    useRobotStore.getState().selectMountZone(zoneId);
    useRobotStore.getState().placeMotor();
  }

  const afterMotors = useRobotStore.getState();
  const motors = afterMotors.parts.filter((part) => part.type === "Motor");
  for (const motor of motors) {
    useRobotStore.getState().selectWheelCatalogueItem("standard-rubber");
    useRobotStore.getState().assignWheel(motor.id);
  }

  useRobotStore.getState().applySuggestedDrivetrainMapping(true);

  const ultrasonicPartId = options?.addUltrasonic
    ? useRobotStore
        .getState()
        .installElectricalCatalogueItem("elec-hcsr04-ultrasonic", {
          position: [0.35, 0.14, 0],
        }) ?? undefined
    : undefined;

  const afterAssembly = useRobotStore.getState();
  const batteryId = afterAssembly.parts.find((part) => part.type === "Battery")!.id;
  const controllerId = afterAssembly.parts.find((part) => part.type === "Controller")!.id;
  const leftMotorId = afterAssembly.parts.find(
    (part) => part.type === "Motor" && part.mountingZoneId === "front-left"
  )!.id;
  const rightMotorId = afterAssembly.parts.find(
    (part) => part.type === "Motor" && part.mountingZoneId === "front-right"
  )!.id;
  const leftWheelId = afterAssembly.drivetrain.left[0]!.wheelId;
  const rightWheelId = afterAssembly.drivetrain.right[0]!.wheelId;

  if (options?.wireEscAndMotors) {
    const addConn = useRobotStore.getState().addElectricalConnection;
    const escLeftId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-esc-brushed-30a")!;
    const escRightId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-esc-brushed-30a")!;

    addConn({
      sourcePartId: batteryId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: escLeftId,
      targetInterfaceId: "esc-bat-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: escLeftId,
      sourceInterfaceId: "esc-motor-out",
      targetPartId: leftMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: batteryId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: escRightId,
      targetInterfaceId: "esc-bat-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: escRightId,
      sourceInterfaceId: "esc-motor-out",
      targetPartId: rightMotorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    wireCommonGroundFixture([escLeftId, escRightId, controllerId], batteryId);
  }

  if (options?.savedProgram) {
    saveVisualProgram(options.savedProgram);
    useRobotStore.getState().setVisualProgram(options.savedProgram);
  }

  return {
    batteryId,
    controllerId,
    leftMotorId,
    rightMotorId,
    leftWheelId,
    rightWheelId,
    structuralPartId,
    ultrasonicPartId,
  };
}
