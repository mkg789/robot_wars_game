import { Euler, Vector3 } from "three";
import type {
  MeshAssetInspection,
  StlLengthUnit,
} from "../types/foundation.types";

export const STL_UNIT_TO_METERS: Readonly<Record<StlLengthUnit, number>> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
};

export interface ParsedStlData {
  /** Interleaved flat triangle vertex positions (9 floats per triangle) */
  readonly positions: Float32Array;
  /** Interleaved flat vertex normals matching triangle winding (9 floats per triangle) */
  readonly normals: Float32Array;
  readonly inspection: MeshAssetInspection;
}

const MIN_VALID_AREA_SQ = 1e-16;
const QUANTIZE_KEY_SCALE = 10000;

function quantizeCoordKey(x: number, y: number, z: number): string {
  return `${Math.round(x * QUANTIZE_KEY_SCALE)}_${Math.round(y * QUANTIZE_KEY_SCALE)}_${Math.round(z * QUANTIZE_KEY_SCALE)}`;
}

function isProbablyAsciiStl(bytes: Uint8Array): boolean {
  if (bytes.length < 15) return false;
  const headerLen = Math.min(bytes.length, 512);
  let header = "";
  for (let i = 0; i < headerLen; i++) {
    header += String.fromCharCode(bytes[i]);
  }
  const trimmed = header.trimStart().toLowerCase();
  if (!trimmed.startsWith("solid")) return false;
  // Binary STLs occasionally start header with "solid "; confirm ASCII keywords appear
  const sampleLen = Math.min(bytes.length, 4096);
  let sample = "";
  for (let i = 0; i < sampleLen; i++) {
    sample += String.fromCharCode(bytes[i]);
  }
  return /\bfacet\s+normal\b/i.test(sample) && /\bvertex\b/i.test(sample);
}

function parseBinaryStl(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength < 84) {
    throw new Error("STL file is too short to contain a valid binary STL header.");
  }
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  const expectedBytes = 84 + triangleCount * 50;
  if (triangleCount === 0) {
    throw new Error("STL mesh contains 0 triangles.");
  }
  if (buffer.byteLength < expectedBytes) {
    throw new Error(
      `Truncated binary STL: header declares ${triangleCount} triangles (${expectedBytes} bytes) but file has ${buffer.byteLength} bytes.`
    );
  }

  const positions = new Float32Array(triangleCount * 9);
  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    // Skip 12-byte normal; compute consistent geometric normal during inspection
    const vBase = offset + 12;
    const pBase = i * 9;
    positions[pBase] = view.getFloat32(vBase, true);
    positions[pBase + 1] = view.getFloat32(vBase + 4, true);
    positions[pBase + 2] = view.getFloat32(vBase + 8, true);

    positions[pBase + 3] = view.getFloat32(vBase + 12, true);
    positions[pBase + 4] = view.getFloat32(vBase + 16, true);
    positions[pBase + 5] = view.getFloat32(vBase + 20, true);

    positions[pBase + 6] = view.getFloat32(vBase + 24, true);
    positions[pBase + 7] = view.getFloat32(vBase + 28, true);
    positions[pBase + 8] = view.getFloat32(vBase + 32, true);

    offset += 50;
  }
  return positions;
}

function parseAsciiStl(text: string): Float32Array {
  const vertexRegex =
    /vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/gi;
  const coords: number[] = [];
  let match: RegExpExecArray | null = vertexRegex.exec(text);
  while (match !== null) {
    coords.push(Number(match[1]), Number(match[2]), Number(match[3]));
    match = vertexRegex.exec(text);
  }
  if (coords.length === 0 || coords.length % 9 !== 0) {
    throw new Error(
      "Invalid ASCII STL: expected complete triangle triplets with 3 vertices per facet."
    );
  }
  return new Float32Array(coords);
}

/**
 * Inspects STL triangle positions for manifold edges, open boundaries, degenerate triangles,
 * bounds, signed volume, and area-weighted centroid without external CAD dependencies.
 */
export function inspectStlGeometry(
  positions: Float32Array,
  fileName: string,
  format: "binary" | "ascii"
): { normals: Float32Array; inspection: MeshAssetInspection } {
  const triangleCount = Math.floor(positions.length / 9);
  const normals = new Float32Array(triangleCount * 9);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (triangleCount === 0) {
    errors.push("Imported STL contains zero triangles.");
    return {
      normals,
      inspection: {
        fileName,
        format,
        triangleCount: 0,
        vertexCount: 0,
        degenerateTriangleCount: 0,
        openEdgeCount: 0,
        nonManifoldEdgeCount: 0,
        isClosedManifold: false,
        isValidGeometry: false,
        rawBoundsMin: [0, 0, 0],
        rawBoundsMax: [0, 0, 0],
        rawDimensions: [0, 0, 0],
        rawCentroid: [0, 0, 0],
        rawSignedVolume: 0,
        warnings,
        errors,
      },
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  let degenerateCount = 0;
  let signedVolume6 = 0;
  let areaWeightedX = 0;
  let areaWeightedY = 0;
  let areaWeightedZ = 0;
  let totalArea = 0;
  let hasNonFinite = false;

  // Undirected edge incidence count for lightweight open / non-manifold edge check
  const edgeCounts = new Map<string, number>();

  for (let t = 0; t < triangleCount; t++) {
    const i = t * 9;
    const ax = positions[i];
    const ay = positions[i + 1];
    const az = positions[i + 2];
    const bx = positions[i + 3];
    const by = positions[i + 4];
    const bz = positions[i + 5];
    const cx = positions[i + 6];
    const cy = positions[i + 7];
    const cz = positions[i + 8];

    if (
      !Number.isFinite(ax) ||
      !Number.isFinite(ay) ||
      !Number.isFinite(az) ||
      !Number.isFinite(bx) ||
      !Number.isFinite(by) ||
      !Number.isFinite(bz) ||
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(cz)
    ) {
      hasNonFinite = true;
      continue;
    }

    minX = Math.min(minX, ax, bx, cx);
    maxX = Math.max(maxX, ax, bx, cx);
    minY = Math.min(minY, ay, by, cy);
    maxY = Math.max(maxY, ay, by, cy);
    minZ = Math.min(minZ, az, bz, cz);
    maxZ = Math.max(maxZ, az, bz, cz);

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const crossSq = nx * nx + ny * ny + nz * nz;

    if (crossSq <= MIN_VALID_AREA_SQ) {
      degenerateCount++;
    } else {
      const len = Math.sqrt(crossSq);
      const area = len * 0.5;
      totalArea += area;
      areaWeightedX += ((ax + bx + cx) / 3) * area;
      areaWeightedY += ((ay + by + cy) / 3) * area;
      areaWeightedZ += ((az + bz + cz) / 3) * area;

      const unx = nx / len;
      const uny = ny / len;
      const unz = nz / len;
      normals[i] = unx;
      normals[i + 1] = uny;
      normals[i + 2] = unz;
      normals[i + 3] = unx;
      normals[i + 4] = uny;
      normals[i + 5] = unz;
      normals[i + 6] = unx;
      normals[i + 7] = uny;
      normals[i + 8] = unz;
    }

    signedVolume6 +=
      ax * (by * cz - bz * cy) +
      bx * (cy * az - cz * ay) +
      cx * (ay * bz - az * by);

    const ka = quantizeCoordKey(ax, ay, az);
    const kb = quantizeCoordKey(bx, by, bz);
    const kc = quantizeCoordKey(cx, cy, cz);
    const edges: Array<[string, string]> = [
      ka < kb ? [ka, kb] : [kb, ka],
      kb < kc ? [kb, kc] : [kc, kb],
      kc < ka ? [kc, ka] : [ka, kc],
    ];
    for (const [u, v] of edges) {
      if (u === v) continue;
      const key = `${u}|${v}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  let openEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) openEdgeCount++;
    else if (count > 2) nonManifoldEdgeCount++;
  }

  if (hasNonFinite) {
    errors.push("Mesh contains NaN or Infinity vertex coordinates.");
  }
  const dimX = Number.isFinite(maxX - minX) ? maxX - minX : 0;
  const dimY = Number.isFinite(maxY - minY) ? maxY - minY : 0;
  const dimZ = Number.isFinite(maxZ - minZ) ? maxZ - minZ : 0;

  if (dimX <= 0 && dimY <= 0 && dimZ <= 0) {
    errors.push("Mesh bounding dimensions are zero; all vertices coincide.");
  }
  if (degenerateCount > 0) {
    warnings.push(`${degenerateCount} degenerate/zero-area triangle(s) detected.`);
  }
  if (openEdgeCount > 0) {
    warnings.push(
      `Mesh is open (${openEdgeCount} boundary edge(s)); volumetric density mass estimates may be unreliable.`
    );
  }
  if (nonManifoldEdgeCount > 0) {
    warnings.push(
      `${nonManifoldEdgeCount} non-manifold edge(s) shared by more than 2 triangles.`
    );
  }

  const isClosedManifold =
    !hasNonFinite &&
    errors.length === 0 &&
    openEdgeCount === 0 &&
    nonManifoldEdgeCount === 0 &&
    triangleCount >= 4;

  const centroid: [number, number, number] =
    totalArea > 0
      ? [
          areaWeightedX / totalArea,
          areaWeightedY / totalArea,
          areaWeightedZ / totalArea,
        ]
      : [
          (minX + maxX) * 0.5 || 0,
          (minY + maxY) * 0.5 || 0,
          (minZ + maxZ) * 0.5 || 0,
        ];

  return {
    normals,
    inspection: {
      fileName,
      format,
      triangleCount,
      vertexCount: triangleCount * 3,
      degenerateTriangleCount: degenerateCount,
      openEdgeCount,
      nonManifoldEdgeCount,
      isClosedManifold,
      isValidGeometry: errors.length === 0 && triangleCount > degenerateCount,
      rawBoundsMin: [
        Number.isFinite(minX) ? minX : 0,
        Number.isFinite(minY) ? minY : 0,
        Number.isFinite(minZ) ? minZ : 0,
      ],
      rawBoundsMax: [
        Number.isFinite(maxX) ? maxX : 0,
        Number.isFinite(maxY) ? maxY : 0,
        Number.isFinite(maxZ) ? maxZ : 0,
      ],
      rawDimensions: [dimX, dimY, dimZ],
      rawCentroid: centroid,
      rawSignedVolume: Math.abs(signedVolume6 / 6),
      warnings,
      errors,
    },
  };
}

/**
 * Parses a binary or ASCII STL ArrayBuffer into triangle vertices, normals, and inspection metadata.
 */
export function parseStlArrayBuffer(
  buffer: ArrayBuffer,
  fileName = "imported.stl"
): ParsedStlData {
  const bytes = new Uint8Array(buffer);
  const ascii = isProbablyAsciiStl(bytes);
  let positions: Float32Array;
  let format: "binary" | "ascii";

  if (ascii) {
    const text = new TextDecoder("utf-8").decode(bytes);
    positions = parseAsciiStl(text);
    format = "ascii";
  } else {
    positions = parseBinaryStl(buffer);
    format = "binary";
  }

  const { normals, inspection } = inspectStlGeometry(positions, fileName, format);
  return { positions, normals, inspection };
}

/**
 * Encodes a triangle list into a valid Binary STL ArrayBuffer (handy for tests & round-trips).
 */
export function buildBinaryStlBuffer(
  triangles: ReadonlyArray<
    readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ]
  >
): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const [a, b, c] of triangles) {
    // 12 bytes zero normal + 36 bytes vertices + 2 bytes attr
    view.setFloat32(offset + 12, a[0], true);
    view.setFloat32(offset + 16, a[1], true);
    view.setFloat32(offset + 20, a[2], true);

    view.setFloat32(offset + 24, b[0], true);
    view.setFloat32(offset + 28, b[1], true);
    view.setFloat32(offset + 32, b[2], true);

    view.setFloat32(offset + 36, c[0], true);
    view.setFloat32(offset + 40, c[1], true);
    view.setFloat32(offset + 44, c[2], true);
    offset += 50;
  }
  return buffer;
}

/**
 * Computes canonical unrotated local SI dimensions [length X, height Y, width Z] in meters
 * from raw STL dimensions, length unit, and scale multiplier (prior to part rotation).
 */
export function computeLocalStlExtents(params: {
  readonly rawDimensions: readonly [number, number, number];
  readonly unit: StlLengthUnit;
  readonly scale: readonly [number, number, number];
}): readonly [number, number, number] {
  const unitFactor = STL_UNIT_TO_METERS[params.unit];
  return [
    Math.max(1e-5, params.rawDimensions[0] * unitFactor * params.scale[0]),
    Math.max(1e-5, params.rawDimensions[1] * unitFactor * params.scale[1]),
    Math.max(1e-5, params.rawDimensions[2] * unitFactor * params.scale[2]),
  ];
}

/**
 * Computes canonical SI dimensions (length X, height Y, width Z in meters) and rotated world bounds
 * from raw STL dimensions, selected length unit, scale multiplier, and CAD orientation offset.
 */
export function computeTransformedStlExtents(params: {
  readonly rawDimensions: readonly [number, number, number];
  readonly unit: StlLengthUnit;
  readonly scale: readonly [number, number, number];
  readonly orientationRotation: readonly [number, number, number];
}): readonly [number, number, number] {
  const unitFactor = STL_UNIT_TO_METERS[params.unit];
  const sx = Math.max(1e-5, params.rawDimensions[0] * unitFactor * params.scale[0]);
  const sy = Math.max(1e-5, params.rawDimensions[1] * unitFactor * params.scale[1]);
  const sz = Math.max(1e-5, params.rawDimensions[2] * unitFactor * params.scale[2]);

  const euler = new Euler(...params.orientationRotation, "XYZ");
  const ax = new Vector3(sx, 0, 0).applyEuler(euler);
  const ay = new Vector3(0, sy, 0).applyEuler(euler);
  const az = new Vector3(0, 0, sz).applyEuler(euler);

  return [
    Math.abs(ax.x) + Math.abs(ay.x) + Math.abs(az.x),
    Math.abs(ax.y) + Math.abs(ay.y) + Math.abs(az.y),
    Math.abs(ax.z) + Math.abs(ay.z) + Math.abs(az.z),
  ];
}
