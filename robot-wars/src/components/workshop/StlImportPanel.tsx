import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCustomCollisionConfig,
  IMPORTED_MATERIAL_PRESETS,
  resolveImportedEngineeringProperties,
} from "../../features/robot-builder/logic/customCollision";
import {
  releaseMeshAsset,
  registerParsedStlAsset,
} from "../../features/robot-builder/logic/meshAssetRegistry";
import {
  computeLocalStlExtents,
  computeTransformedStlExtents,
  parseStlArrayBuffer,
  type ParsedStlData,
} from "../../features/robot-builder/logic/stlParser";
import type {
  CustomCollisionConfig,
  CustomCollisionMode,
  ImportedEngineeringProperties,
  ImportedMassMode,
  ImportedMaterialId,
  ImportedMeshTransform,
  MeshAssetInspection,
  StlLengthUnit,
} from "../../features/robot-builder/types/robot.types";

interface StlImportPanelProps {
  readonly targetKind: "foundation" | "structural";
  readonly onConfirmImport: (payload: {
    assetId: string;
    fileName: string;
    inspection: MeshAssetInspection;
    transform: ImportedMeshTransform;
    engineering: ImportedEngineeringProperties;
    collision: CustomCollisionConfig;
    name?: string;
  }) => void;
  readonly onCancel?: () => void;
}

const DEG_TO_RAD = Math.PI / 180;

export default function StlImportPanel({
  targetKind,
  onConfirmImport,
  onCancel,
}: StlImportPanelProps) {
  const [parsed, setParsed] = useState<ParsedStlData | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [partName, setPartName] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [unit, setUnit] = useState<StlLengthUnit>("mm");
  const [unitConfirmed, setUnitConfirmed] = useState(false);
  const [scaleMode, setScaleMode] = useState<"uniform" | "non-uniform">("uniform");
  const [uniformScale, setUniformScale] = useState(1);
  const [nonUniformScale, setNonUniformScale] = useState<[number, number, number]>([1, 1, 1]);
  const [rotDeg, setRotDeg] = useState<[number, number, number]>([0, 0, 0]);
  const [posOffset, setPosOffset] = useState<[number, number, number]>([0, 0, 0]);

  const [materialId, setMaterialId] = useState<ImportedMaterialId>("unknown");
  const [massMode, setMassMode] = useState<ImportedMassMode>("unknown");
  const [userMassKg, setUserMassKg] = useState<number>(2.5);
  const [comMode, setComMode] = useState<"user" | "calculated" | "unknown">("calculated");
  const [inertiaMode, setInertiaMode] = useState<"user" | "calculated" | "unknown">("calculated");
  const [collisionMode, setCollisionMode] = useState<CustomCollisionMode>("bounding-box");

  const previewAssetRef = useRef<string | null>(null);
  useEffect(() => {
    previewAssetRef.current = previewAssetId;
  }, [previewAssetId]);

  // Clean up unconfirmed preview assets when component unmounts
  useEffect(() => {
    return () => {
      if (previewAssetRef.current) {
        releaseMeshAsset(previewAssetRef.current);
      }
    };
  }, []);

  const loadFile = async (file: File) => {
    setErrorMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const result = parseStlArrayBuffer(buffer, file.name);
      if (previewAssetRef.current) {
        releaseMeshAsset(previewAssetRef.current);
      }
      const record = registerParsedStlAsset(result);
      setPreviewAssetId(record.assetId);
      setParsed(result);
      setFileName(file.name);
      setPartName(file.name.replace(/\.stl$/i, "") || "Custom STL");
      setUnitConfirmed(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to parse STL file.");
    }
  };

  const transform: ImportedMeshTransform = useMemo(
    () => ({
      unit,
      unitConfirmed,
      scaleMode,
      uniformScale: Number.isFinite(uniformScale) && uniformScale > 0 ? uniformScale : 1,
      nonUniformScale: nonUniformScale.map((v) =>
        Number.isFinite(v) && v > 0 ? v : 1
      ) as [number, number, number],
      orientationRotation: [
        rotDeg[0] * DEG_TO_RAD,
        rotDeg[1] * DEG_TO_RAD,
        rotDeg[2] * DEG_TO_RAD,
      ],
      positionOffset: posOffset,
    }),
    [unit, unitConfirmed, scaleMode, uniformScale, nonUniformScale, rotDeg, posOffset]
  );

  const calculatedExtents = useMemo(() => {
    if (!parsed) return null;
    const scaleTuple =
      transform.scaleMode === "uniform"
        ? ([
            transform.uniformScale,
            transform.uniformScale,
            transform.uniformScale,
          ] as const)
        : transform.nonUniformScale;
    return computeTransformedStlExtents({
      rawDimensions: parsed.inspection.rawDimensions,
      unit: transform.unit,
      scale: scaleTuple,
      orientationRotation: transform.orientationRotation,
    });
  }, [parsed, transform]);

  const engineeringPreview = useMemo(() => {
    if (!parsed) return null;
    return resolveImportedEngineeringProperties({
      inspection: parsed.inspection,
      transform,
      materialId,
      massMode,
      userMassKg,
      centerOfMassMode: comMode,
      inertiaMode,
    });
  }, [parsed, transform, materialId, massMode, userMassKg, comMode, inertiaMode]);

  const localExtents = useMemo(() => {
    if (!parsed) return null;
    const scaleTuple =
      transform.scaleMode === "uniform"
        ? ([
            transform.uniformScale,
            transform.uniformScale,
            transform.uniformScale,
          ] as const)
        : transform.nonUniformScale;
    return computeLocalStlExtents({
      rawDimensions: parsed.inspection.rawDimensions,
      unit: transform.unit,
      scale: scaleTuple,
    });
  }, [parsed, transform]);

  const collisionPreview = useMemo(() => {
    if (!localExtents || !previewAssetId) return null;
    return buildCustomCollisionConfig({
      mode: collisionMode,
      extents: localExtents,
      assetId: previewAssetId,
    });
  }, [localExtents, collisionMode, previewAssetId]);

  const handleConfirm = () => {
    if (!parsed || !previewAssetId || !engineeringPreview || !collisionPreview) return;
    if (!parsed.inspection.isValidGeometry) return;

    const confirmedAssetId = previewAssetId;
    // Hand off retained ownership cleanly to store without release on unmount
    previewAssetRef.current = null;
    setPreviewAssetId(null);

    onConfirmImport({
      assetId: confirmedAssetId,
      fileName: fileName || parsed.inspection.fileName,
      inspection: parsed.inspection,
      transform: { ...transform, unitConfirmed: true },
      engineering: engineeringPreview,
      collision: collisionPreview,
      name: partName.trim() || undefined,
    });
    // Ownership has transferred to store; release the preview registration ref cleanly
    releaseMeshAsset(confirmedAssetId);
    setParsed(null);
  };

  const handleResetImport = () => {
    if (previewAssetRef.current) {
      releaseMeshAsset(previewAssetRef.current);
      previewAssetRef.current = null;
    }
    setPreviewAssetId(null);
    setParsed(null);
    setErrorMsg(null);
    onCancel?.();
  };

  return (
    <div className="workshop-stl-importer">
      <div
        className={`workshop-stl-dropzone ${isDragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void loadFile(file);
        }}
      >
        <p className="builder-intro" style={{ marginBottom: 6 }}>
          Import Binary or ASCII <strong>.STL</strong> mesh for{" "}
          {targetKind === "foundation" ? "robot foundation" : "structural component"}.
        </p>
        <input
          type="file"
          accept=".stl"
          aria-label="Choose STL file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
          }}
        />
      </div>

      {errorMsg && (
        <div className="workshop-diag-item error" role="alert">
          <strong>IMPORT ERROR</strong>
          <span>{errorMsg}</span>
        </div>
      )}

      {parsed && calculatedExtents && engineeringPreview && (
        <>
          <div className="workshop-mount-target">
            <div className="section-label">MESH INSPECTION</div>
            <div className="property-row">
              <span>Format / Triangles</span>
              <span>
                {parsed.inspection.format.toUpperCase()} · {parsed.inspection.triangleCount}
              </span>
            </div>
            <div className="property-row">
              <span>Watertight Manifold</span>
              <span>{parsed.inspection.isClosedManifold ? "Closed" : "Open / Non-manifold"}</span>
            </div>
            <div className="property-row">
              <span>SI Dimensions (L×H×W)</span>
              <span>
                {calculatedExtents[0].toFixed(3)} × {calculatedExtents[1].toFixed(3)} ×{" "}
                {calculatedExtents[2].toFixed(3)} m
              </span>
            </div>
            {parsed.inspection.warnings.map((w, i) => (
              <div key={i} className="workshop-diag-item warning">
                <span>{w}</span>
              </div>
            ))}
            {parsed.inspection.errors.map((e, i) => (
              <div key={i} className="workshop-diag-item error">
                <span>{e}</span>
              </div>
            ))}
          </div>

          <div className="workshop-mount-target">
            <div className="section-label">UNITS, SCALE &amp; ORIENTATION</div>
            <label className="sim-select-field">
              <span>Name</span>
              <input
                type="text"
                className="workshop-search-input"
                aria-label="Imported component name"
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
              />
            </label>
            <label className="sim-select-field">
              <span>Source STL Unit (assumed {unit})</span>
              <select
                aria-label="STL length unit"
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value as StlLengthUnit);
                  setUnitConfirmed(true);
                }}
              >
                <option value="mm">Millimeters (mm)</option>
                <option value="cm">Centimeters (cm)</option>
                <option value="m">Meters (m)</option>
                <option value="in">Inches (in)</option>
              </select>
            </label>
            <label className="foundation-option">
              <input
                type="checkbox"
                checked={unitConfirmed}
                onChange={(e) => setUnitConfirmed(e.target.checked)}
              />
              Confirm unit conversion ({unit} → m)
            </label>

            <div className="workshop-filter-chips" style={{ marginTop: 6 }}>
              <button
                type="button"
                className={`workshop-chip ${scaleMode === "uniform" ? "active" : ""}`}
                onClick={() => setScaleMode("uniform")}
              >
                Uniform Scale
              </button>
              <button
                type="button"
                className={`workshop-chip ${scaleMode === "non-uniform" ? "active" : ""}`}
                onClick={() => setScaleMode("non-uniform")}
              >
                Non-Uniform
              </button>
              <button
                type="button"
                className="workshop-chip"
                onClick={() => {
                  setScaleMode("uniform");
                  setUniformScale(1);
                  setNonUniformScale([1, 1, 1]);
                  setRotDeg([0, 0, 0]);
                  setPosOffset([0, 0, 0]);
                }}
              >
                Reset
              </button>
            </div>

            {scaleMode === "uniform" ? (
              <div className="property-row">
                <span>Uniform Scale ×</span>
                <input
                  type="number"
                  aria-label="Uniform scale"
                  step={0.1}
                  min={0.01}
                  value={uniformScale}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) setUniformScale(v);
                  }}
                />
              </div>
            ) : (
              <div className="workshop-filter-chips">
                {(["X", "Y", "Z"] as const).map((axis, idx) => (
                  <label key={axis} className="sim-select-field">
                    <span>Scale {axis}</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0.01}
                      value={nonUniformScale[idx]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v <= 0) return;
                        const next: [number, number, number] = [...nonUniformScale];
                        next[idx] = v;
                        setNonUniformScale(next);
                      }}
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="workshop-filter-chips" style={{ marginTop: 6 }}>
              <button
                type="button"
                className="workshop-chip"
                onClick={() => setRotDeg([-90, 0, 0])}
                title="Convert CAD Z-up exports to Robot Wars Y-up"
              >
                Z-Up → Y-Up
              </button>
              <button
                type="button"
                className="workshop-chip"
                onClick={() => setRotDeg([rotDeg[0], rotDeg[1] + 90, rotDeg[2]])}
              >
                Yaw +90°
              </button>
              <button
                type="button"
                className="workshop-chip"
                onClick={() => setRotDeg([0, 0, 0])}
              >
                Reset Orient
              </button>
            </div>
          </div>

          <div className="workshop-mount-target">
            <div className="section-label">ENGINEERING &amp; COLLISION</div>
            <label className="sim-select-field">
              <span>Material Preset</span>
              <select
                aria-label="Imported material"
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value as ImportedMaterialId)}
              >
                {IMPORTED_MATERIAL_PRESETS.map((mat) => (
                  <option key={mat.id} value={mat.id}>
                    {mat.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="sim-select-field">
              <span>Mass Source</span>
              <select
                aria-label="Imported mass mode"
                value={massMode}
                onChange={(e) => setMassMode(e.target.value as ImportedMassMode)}
              >
                <option value="unknown">Unknown Mass</option>
                <option value="user">User-Entered Mass (kg)</option>
                <option
                  value="estimated-density"
                  disabled={!parsed.inspection.isClosedManifold || materialId === "unknown"}
                >
                  Estimate from Closed Volume × Density
                </option>
              </select>
            </label>
            {massMode === "user" && (
              <div className="property-row">
                <span>Mass (kg)</span>
                <input
                  type="number"
                  step={0.1}
                  min={0.01}
                  value={userMassKg}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) setUserMassKg(v);
                  }}
                />
              </div>
            )}
            <label className="sim-select-field">
              <span>Center of Mass</span>
              <select
                value={comMode}
                onChange={(e) => setComMode(e.target.value as "user" | "calculated" | "unknown")}
              >
                <option value="calculated">Calculated Centroid (Est.)</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="sim-select-field">
              <span>Inertia Tensor</span>
              <select
                value={inertiaMode}
                onChange={(e) =>
                  setInertiaMode(e.target.value as "user" | "calculated" | "unknown")
                }
              >
                <option value="calculated">Box Approximation (Est.)</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="sim-select-field">
              <span>Collision Proxy</span>
              <select
                aria-label="Collision proxy representation"
                value={collisionMode}
                onChange={(e) => setCollisionMode(e.target.value as CustomCollisionMode)}
              >
                <option value="bounding-box">Axis-Aligned Bounding Box</option>
                <option value="single-box">Simplified Single Box</option>
                <option value="multi-box">Simplified Multi-Box (Quadrants)</option>
                <option value="convex-approx">Convex Envelope Approximation</option>
              </select>
            </label>
            <small className="builder-intro">
              Resolved mass:{" "}
              {engineeringPreview.massKg !== undefined
                ? `${engineeringPreview.massKg.toFixed(3)} kg (${engineeringPreview.provenance.method})`
                : "Unknown"}
            </small>
          </div>

          <div className="workshop-inline-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!parsed.inspection.isValidGeometry}
              onClick={handleConfirm}
            >
              Use Imported STL
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleResetImport}
            >
              Cancel Import
            </button>
          </div>
        </>
      )}
    </div>
  );
}
