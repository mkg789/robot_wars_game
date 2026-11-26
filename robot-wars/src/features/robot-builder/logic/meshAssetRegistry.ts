import * as THREE from "three";
import type { MeshAssetInspection } from "../types/foundation.types";
import { parseStlArrayBuffer, type ParsedStlData } from "./stlParser";

export interface MeshAssetRecord {
  readonly assetId: string;
  readonly normals: Float32Array;
  readonly inspection: MeshAssetInspection;
  /** Centers vertices symmetrically around raw bounding box center for clean robot anchoring */
  readonly centeredPositions: Float32Array;
  refCount: number;
  cachedThreeGeometry: THREE.BufferGeometry | null;
}

const meshAssetMap = new Map<string, MeshAssetRecord>();
const intentionalRegistryDisposals = new WeakSet<THREE.BufferGeometry>();

function disposeCachedGeometry(rec: MeshAssetRecord): void {
  const geometry = rec.cachedThreeGeometry;
  if (!geometry) return;
  rec.cachedThreeGeometry = null;
  intentionalRegistryDisposals.add(geometry);
  try {
    geometry.dispose();
  } finally {
    intentionalRegistryDisposals.delete(geometry);
  }
}

function centerPositionsToBounds(positions: Float32Array, inspection: MeshAssetInspection): Float32Array {
  const cx = (inspection.rawBoundsMin[0] + inspection.rawBoundsMax[0]) * 0.5;
  const cy = (inspection.rawBoundsMin[1] + inspection.rawBoundsMax[1]) * 0.5;
  const cz = (inspection.rawBoundsMin[2] + inspection.rawBoundsMax[2]) * 0.5;

  const centered = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    centered[i] = positions[i] - cx;
    centered[i + 1] = positions[i + 1] - cy;
    centered[i + 2] = positions[i + 2] - cz;
  }
  return centered;
}

/**
 * Registers parsed STL geometry once in a stable session-level asset store.
 * Large typed arrays stay outside Zustand history snapshots; parts reference `assetId` only.
 */
export function registerParsedStlAsset(
  parsed: ParsedStlData,
  preferredAssetId?: string
): MeshAssetRecord {
  const assetId = preferredAssetId ?? `stl-${crypto.randomUUID()}`;
  const centeredPositions = centerPositionsToBounds(parsed.positions, parsed.inspection);
  const record: MeshAssetRecord = {
    assetId,
    normals: parsed.normals,
    centeredPositions,
    inspection: parsed.inspection,
    refCount: 1,
    cachedThreeGeometry: null,
  };
  meshAssetMap.set(assetId, record);
  return record;
}

export function registerStlBufferAsset(
  buffer: ArrayBuffer,
  fileName = "imported.stl",
  preferredAssetId?: string
): MeshAssetRecord {
  const parsed = parseStlArrayBuffer(buffer, fileName);
  return registerParsedStlAsset(parsed, preferredAssetId);
}

export function getMeshAssetRecord(assetId: string | undefined): MeshAssetRecord | null {
  if (!assetId) return null;
  return meshAssetMap.get(assetId) ?? null;
}

export function retainMeshAsset(assetId: string | undefined): void {
  if (!assetId) return;
  const rec = meshAssetMap.get(assetId);
  if (rec) {
    rec.refCount += 1;
  }
}

export function releaseMeshAsset(assetId: string | undefined): void {
  if (!assetId) return;
  const rec = meshAssetMap.get(assetId);
  if (!rec) return;
  rec.refCount = Math.max(0, rec.refCount - 1);
  if (rec.refCount === 0) {
    disposeCachedGeometry(rec);
    meshAssetMap.delete(assetId);
  }
}

export function syncActiveAssetRefs(activeAssetIds: Iterable<string>): void {
  const activeSet = new Set(activeAssetIds);
  for (const [assetId, rec] of meshAssetMap.entries()) {
    if (!activeSet.has(assetId)) {
      disposeCachedGeometry(rec);
      meshAssetMap.delete(assetId);
    }
  }
}

/**
 * Lazily builds and caches a single reusable Three.js BufferGeometry per STL asset.
 * Callers must apply unit scale, transform, and orientation via parent Group transforms
 * rather than mutating this cached BufferGeometry in place.
 * Accidental external `.dispose()` calls are blocked so individual R3F mesh unmounts
 * cannot free GPU buffers while the asset remains retained by the registry.
 */
export function getOrCreateThreeBufferGeometry(
  assetId: string
): THREE.BufferGeometry | null {
  const rec = meshAssetMap.get(assetId);
  if (!rec) return null;
  if (rec.cachedThreeGeometry) return rec.cachedThreeGeometry;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(rec.centeredPositions, 3)
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(rec.normals, 3)
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.dispose = function disposeRegistryCachedGeometry(
    this: THREE.BufferGeometry
  ): void {
    if (!intentionalRegistryDisposals.has(this)) {
      return;
    }
    THREE.BufferGeometry.prototype.dispose.call(this);
  };
  rec.cachedThreeGeometry = geometry;
  return geometry;
}

export function getRegisteredAssetCount(): number {
  return meshAssetMap.size;
}

export function clearMeshAssets(): void {
  for (const rec of meshAssetMap.values()) {
    disposeCachedGeometry(rec);
  }
  meshAssetMap.clear();
}

/**
 * Restores a previously serialized STL mesh asset directly from its centered vertex/normal buffers
 * without re-applying centroid subtraction. Starts at refCount = 0 so store retention sync
 * establishes the exact reference count for active parts and history snapshots.
 */
export function restoreMeshAssetRecord(params: {
  readonly assetId: string;
  readonly centeredPositions: Float32Array;
  readonly normals: Float32Array;
  readonly inspection: MeshAssetInspection;
}): MeshAssetRecord {
  const existing = meshAssetMap.get(params.assetId);
  if (existing) {
    disposeCachedGeometry(existing);
  }
  const record: MeshAssetRecord = {
    assetId: params.assetId,
    centeredPositions: new Float32Array(params.centeredPositions),
    normals: new Float32Array(params.normals),
    inspection: structuredClone(params.inspection),
    refCount: existing ? existing.refCount : 0,
    cachedThreeGeometry: null,
  };
  meshAssetMap.set(params.assetId, record);
  return record;
}

/**
 * Encodes a Float32Array buffer deterministically as base64 in both browser and Node environments.
 */
export function encodeFloat32ArrayBase64(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Decodes and validates a base64-encoded Float32Array buffer (little-endian IEEE 754 floats).
 */
export function decodeFloat32ArrayBase64(encoded: string): Float32Array {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error("Mesh buffer base64 payload must be a non-empty string.");
  }
  const binary = atob(encoded);
  if (binary.length === 0 || binary.length % 4 !== 0) {
    throw new Error(
      `Invalid Float32 byte length (${binary.length}): expected a non-zero multiple of 4.`
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const floats = new Float32Array(bytes.buffer);
  for (let i = 0; i < floats.length; i += 1) {
    if (!Number.isFinite(floats[i])) {
      throw new Error(`Mesh buffer contains non-finite float value at index ${i}.`);
    }
  }
  return floats;
}
