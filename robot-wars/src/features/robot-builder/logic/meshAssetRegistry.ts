import * as THREE from "three";
import type { MeshAssetInspection } from "../types/foundation.types";
import { parseStlArrayBuffer, type ParsedStlData } from "./stlParser";

export interface MeshAssetRecord {
  readonly assetId: string;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly inspection: MeshAssetInspection;
  /** Centers vertices symmetrically around raw bounding box center for clean robot anchoring */
  readonly centeredPositions: Float32Array;
  refCount: number;
  cachedThreeGeometry: THREE.BufferGeometry | null;
}

const meshAssetMap = new Map<string, MeshAssetRecord>();

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
    positions: parsed.positions,
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
    rec.cachedThreeGeometry?.dispose();
    rec.cachedThreeGeometry = null;
    meshAssetMap.delete(assetId);
  }
}

export function syncActiveAssetRefs(activeAssetIds: Iterable<string>): void {
  const activeSet = new Set(activeAssetIds);
  for (const [assetId, rec] of meshAssetMap.entries()) {
    if (!activeSet.has(assetId)) {
      rec.cachedThreeGeometry?.dispose();
      rec.cachedThreeGeometry = null;
      meshAssetMap.delete(assetId);
    }
  }
}

/**
 * Lazily builds and caches a single reusable Three.js BufferGeometry per STL asset.
 * Callers must apply unit scale, transform, and orientation via parent Group transforms
 * rather than mutating this cached BufferGeometry in place.
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
  rec.cachedThreeGeometry = geometry;
  return geometry;
}

export function getRegisteredAssetCount(): number {
  return meshAssetMap.size;
}

export function clearMeshAssets(): void {
  for (const rec of meshAssetMap.values()) {
    rec.cachedThreeGeometry?.dispose();
    rec.cachedThreeGeometry = null;
  }
  meshAssetMap.clear();
}
