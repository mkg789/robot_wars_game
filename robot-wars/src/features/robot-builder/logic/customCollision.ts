import type {
  CustomCollisionBox,
  CustomCollisionConfig,
  CustomCollisionMode,
  ImportedEngineeringProperties,
  ImportedMassMode,
  ImportedMaterialId,
  ImportedMeshTransform,
  MeshAssetInspection,
} from "../types/foundation.types";
import { getMeshAssetRecord } from "./meshAssetRegistry";
import { computeLocalStlExtents, STL_UNIT_TO_METERS } from "./stlParser";

export interface ImportedMaterialPreset {
  readonly id: ImportedMaterialId;
  readonly name: string;
  readonly densityKgM3?: number;
  readonly note: string;
}

/**
 * Explicit nominal material density presets. Values are approximate bulk handbook values
 * and never represent verified alloy/print-infill measurements unless supplied by user.
 */
export const IMPORTED_MATERIAL_PRESETS: readonly ImportedMaterialPreset[] = [
  {
    id: "unknown",
    name: "Unknown Material",
    note: "Material unspecified; volumetric density estimation disabled.",
  },
  {
    id: "aluminum-6061",
    name: "Aluminum (6061 nominal)",
    densityKgM3: 2700,
    note: "Nominal solid aluminum density (~2700 kg/m³); hollow pockets affect accuracy.",
  },
  {
    id: "steel-mild",
    name: "Mild Steel (nominal)",
    densityKgM3: 7850,
    note: "Nominal carbon steel density (~7850 kg/m³).",
  },
  {
    id: "abs-plastic",
    name: "ABS Plastic (solid nominal)",
    densityKgM3: 1040,
    note: "Solid ABS density (~1040 kg/m³); 3D-printed infill reduces effective density.",
  },
  {
    id: "pla-plastic",
    name: "PLA Plastic (solid nominal)",
    densityKgM3: 1240,
    note: "Solid PLA density (~1240 kg/m³); 3D-printed infill reduces effective density.",
  },
  {
    id: "carbon-composite",
    name: "Carbon Composite (nominal)",
    densityKgM3: 1600,
    note: "Nominal CFRP laminate density (~1600 kg/m³).",
  },
  {
    id: "custom",
    name: "Custom Density",
    densityKgM3: 2700,
    note: "User-defined bulk density assumption.",
  },
];

/**
 * Estimates mass, center of mass, and bounding-box inertia honestly with clear provenance.
 * Refuses to compute density-based mass when mesh is open/non-manifold or volume is invalid.
 */
export function resolveImportedEngineeringProperties(params: {
  readonly inspection: MeshAssetInspection;
  readonly transform: ImportedMeshTransform;
  readonly materialId: ImportedMaterialId;
  readonly customDensityKgM3?: number;
  readonly massMode: ImportedMassMode;
  readonly userMassKg?: number;
  readonly centerOfMassMode: "user" | "calculated" | "unknown";
  readonly userCenterOfMassLocal?: readonly [number, number, number];
  readonly inertiaMode: "user" | "calculated" | "unknown";
  readonly userInertiaKgM2?: readonly [number, number, number];
}): ImportedEngineeringProperties {
  const preset =
    IMPORTED_MATERIAL_PRESETS.find((m) => m.id === params.materialId) ??
    IMPORTED_MATERIAL_PRESETS[0];
  const density =
    params.materialId === "custom"
      ? params.customDensityKgM3
      : preset.densityKgM3;

  const scaleTuple =
    params.transform.scaleMode === "uniform"
      ? ([
          params.transform.uniformScale,
          params.transform.uniformScale,
          params.transform.uniformScale,
        ] as const)
      : params.transform.nonUniformScale;

  const unitFactor = STL_UNIT_TO_METERS[params.transform.unit];
  const volumeScale =
    unitFactor ** 3 * scaleTuple[0] * scaleTuple[1] * scaleTuple[2];
  const scaledVolumeM3 = params.inspection.rawSignedVolume * volumeScale;

  let resolvedMassKg: number | undefined;
  if (params.massMode === "user") {
    resolvedMassKg =
      params.userMassKg !== undefined &&
      Number.isFinite(params.userMassKg) &&
      params.userMassKg > 0
        ? params.userMassKg
        : undefined;
  } else if (params.massMode === "estimated-density") {
    if (
      params.inspection.isClosedManifold &&
      scaledVolumeM3 > 0 &&
      density !== undefined &&
      density > 0
    ) {
      resolvedMassKg = Number((scaledVolumeM3 * density).toFixed(4));
    } else {
      resolvedMassKg = undefined;
    }
  }

  const rawCenterMid: [number, number, number] = [
    (params.inspection.rawBoundsMin[0] + params.inspection.rawBoundsMax[0]) * 0.5,
    (params.inspection.rawBoundsMin[1] + params.inspection.rawBoundsMax[1]) * 0.5,
    (params.inspection.rawBoundsMin[2] + params.inspection.rawBoundsMax[2]) * 0.5,
  ];
  const localCentroid: [number, number, number] = [
    (params.inspection.rawCentroid[0] - rawCenterMid[0]) * unitFactor * scaleTuple[0],
    (params.inspection.rawCentroid[1] - rawCenterMid[1]) * unitFactor * scaleTuple[1],
    (params.inspection.rawCentroid[2] - rawCenterMid[2]) * unitFactor * scaleTuple[2],
  ];

  const centerOfMassLocal =
    params.centerOfMassMode === "user"
      ? params.userCenterOfMassLocal
      : params.centerOfMassMode === "calculated"
        ? localCentroid
        : undefined;

  // Compute local unrotated SI extents so diagonal inertia tensor is expressed in the part's local frame
  // (robotInertia.ts rotates the tensor into world frame via part.rotation once, preventing double rotation).
  const localExtents = computeLocalStlExtents({
    rawDimensions: params.inspection.rawDimensions,
    unit: params.transform.unit,
    scale: scaleTuple,
  });

  let inertiaKgM2: readonly [number, number, number] | undefined;
  if (params.inertiaMode === "user") {
    inertiaKgM2 = params.userInertiaKgM2;
  } else if (
    params.inertiaMode === "calculated" &&
    resolvedMassKg !== undefined &&
    resolvedMassKg > 0
  ) {
    const [L, H, W] = localExtents;
    inertiaKgM2 = [
      Number(((resolvedMassKg * (H * H + W * W)) / 12).toFixed(6)),
      Number(((resolvedMassKg * (L * L + W * W)) / 12).toFixed(6)),
      Number(((resolvedMassKg * (L * L + H * H)) / 12).toFixed(6)),
    ];
  }

  const method =
    params.massMode === "user" &&
    params.materialId !== "unknown" &&
    params.inertiaMode === "user"
      ? "measured"
      : params.massMode === "unknown" && params.materialId === "unknown"
        ? "unknown"
        : "estimated";

  return {
    materialId: params.materialId,
    materialName: preset.name,
    materialDensityKgM3: density,
    massMode: params.massMode,
    massKg: resolvedMassKg,
    centerOfMassMode: params.centerOfMassMode,
    centerOfMassLocal,
    inertiaMode: params.inertiaMode,
    inertiaKgM2,
    provenance:
      method === "unknown"
        ? {
            method: "unknown",
            notes: "Mass, material, and inertia left unknown on imported STL geometry.",
          }
        : method === "measured"
          ? {
              method: "measured",
              verified: true,
              source: "user-imported-engineering",
              notes: "User-entered mass, material, and inertia values.",
            }
          : {
              method: "estimated",
              basis:
                params.massMode === "estimated-density"
                  ? "Solid closed-manifold STL volume × nominal material density; box inertia approximation."
                  : "User mass combined with uniform bounding-box inertia approximation.",
            },
  };
}

/**
 * Generates decoupled simplified collision proxies ("bounding-box", "single-box",
 * "multi-box", or "convex-approx") from transformed bounds and optional STL vertices,
 * avoiding full triangle-mesh collision overhead in simulation.
 */
export function buildCustomCollisionConfig(params: {
  readonly mode: CustomCollisionMode;
  readonly extents: readonly [number, number, number];
  readonly assetId?: string;
  readonly customBoxes?: readonly CustomCollisionBox[];
}): CustomCollisionConfig {
  const [lx, hy, wz] = params.extents;
  const singleBox: CustomCollisionBox = {
    id: "proxy-primary-box",
    center: [0, 0, 0],
    size: [lx, hy, wz],
  };

  let boxes: CustomCollisionBox[] = [singleBox];
  let notes = "Single axis-aligned collision box matching transformed mesh bounds.";

  if (params.mode === "single-box" && params.customBoxes?.length) {
    boxes = [params.customBoxes[0]];
    notes = "User-configured single collision box proxy.";
  } else if (params.mode === "multi-box") {
    if (params.customBoxes && params.customBoxes.length > 0) {
      boxes = [...params.customBoxes];
      notes = `User-defined ${boxes.length}-box compound collision proxy.`;
    } else {
      const asset = getMeshAssetRecord(params.assetId);
      if (asset && asset.centeredPositions.length >= 9) {
        // Partition centered mesh points into 2×2 XZ grid quadrants (4 max sub-boxes)
        const buckets: Array<{ min: [number, number, number]; max: [number, number, number]; count: number }> = [
          { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], count: 0 },
          { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], count: 0 },
          { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], count: 0 },
          { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], count: 0 },
        ];
        const rawDims = asset.inspection.rawDimensions;
        const sx = rawDims[0] > 1e-6 ? lx / rawDims[0] : 1;
        const sy = rawDims[1] > 1e-6 ? hy / rawDims[1] : 1;
        const sz = rawDims[2] > 1e-6 ? wz / rawDims[2] : 1;
        const pos = asset.centeredPositions;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i] * sx;
          const y = pos[i + 1] * sy;
          const z = pos[i + 2] * sz;
          const idx = (x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0);
          const b = buckets[idx];
          b.count++;
          b.min[0] = Math.min(b.min[0], x);
          b.min[1] = Math.min(b.min[1], y);
          b.min[2] = Math.min(b.min[2], z);
          b.max[0] = Math.max(b.max[0], x);
          b.max[1] = Math.max(b.max[1], y);
          b.max[2] = Math.max(b.max[2], z);
        }
        const generated: CustomCollisionBox[] = [];
        buckets.forEach((b, idx) => {
          if (b.count === 0) return;
          const bx = Math.max(0.02, b.max[0] - b.min[0]);
          const by = Math.max(0.02, b.max[1] - b.min[1]);
          const bz = Math.max(0.02, b.max[2] - b.min[2]);
          generated.push({
            id: `proxy-quad-${idx}`,
            center: [
              (b.min[0] + b.max[0]) * 0.5,
              (b.min[1] + b.max[1]) * 0.5,
              (b.min[2] + b.max[2]) * 0.5,
            ],
            size: [bx, by, bz],
          });
        });
        if (generated.length > 0) {
          boxes = generated;
          notes = `Simplified ${generated.length}-region multi-box collision proxy derived from mesh quadrants.`;
        }
      } else {
        // Symmetric dual-rail default fallback
        boxes = [
          {
            id: "proxy-left",
            center: [0, 0, wz * 0.25],
            size: [lx, hy, wz * 0.5],
          },
          {
            id: "proxy-right",
            center: [0, 0, -wz * 0.25],
            size: [lx, hy, wz * 0.5],
          },
        ];
        notes = "Dual-box collision proxy.";
      }
    }
  } else if (params.mode === "convex-approx") {
    notes =
      "Simplified convex-envelope approximation projected into planar simulation OBB (does not run full 3D convex mesh physics).";
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const b of boxes) {
    minX = Math.min(minX, b.center[0] - b.size[0] * 0.5);
    maxX = Math.max(maxX, b.center[0] + b.size[0] * 0.5);
    minY = Math.min(minY, b.center[1] - b.size[1] * 0.5);
    maxY = Math.max(maxY, b.center[1] + b.size[1] * 0.5);
    minZ = Math.min(minZ, b.center[2] - b.size[2] * 0.5);
    maxZ = Math.max(maxZ, b.center[2] + b.size[2] * 0.5);
  }

  const envL = Math.max(0.05, maxX - minX);
  const envH = Math.max(0.02, maxY - minY);
  const envW = Math.max(0.05, maxZ - minZ);

  return {
    mode: params.mode,
    boxes,
    envelopeSize: [envL, envH, envW],
    envelopeCenter: [
      (minX + maxX) * 0.5,
      (minY + maxY) * 0.5,
      (minZ + maxZ) * 0.5,
    ],
    planarFootprint: {
      lengthM: envL,
      widthM: envW,
    },
    isEstimated: true,
    notes,
  };
}
