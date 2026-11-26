import { useEffect, useMemo, useRef, useState } from "react";
import { structuralCatalogue } from "../../features/robot-builder/data/structuralCatalogue";
import type { AssemblyDiagnostic } from "../../features/robot-builder/logic/assemblyValidation";
import { getPartBoxExtents } from "../../features/robot-builder/logic/geometryAdapters";
import {
  evaluateComponentAttachmentCompatibility,
  evaluateMotorMountCompatibility,
  evaluateMotorWheelCompatibility,
} from "../../features/robot-builder/logic/mechanicalCompatibility";
import {
  hasAttachmentCycle,
  resolvePartMountingInterfaces,
} from "../../features/robot-builder/logic/mountingInterfaces";
import { IMPORTED_MATERIAL_PRESETS } from "../../features/robot-builder/logic/customCollision";
import type { ElectricalConnection } from "../../features/electrical/types/electrical.types";
import ElectricalInspectorSection from "./ElectricalInspectorSection";
import type {
  AttachmentInterface,
  CustomCollisionConfig,
  CustomCollisionMode,
  FoundationConfig,
  ImportedEngineeringProperties,
  ImportedMassMode,
  ImportedMaterialId,
  ImportedMeshTransform,
  RobotConnection,
  RobotPart,
  StructuralCatalogueId,
} from "../../features/robot-builder/types/robot.types";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

interface PartInspectorPanelProps {
  readonly part: RobotPart;
  readonly parts: readonly RobotPart[];
  readonly connections: readonly RobotConnection[];
  readonly foundation: FoundationConfig | null;
  readonly diagnostics: readonly AssemblyDiagnostic[];
  readonly onPreviewTransform: (
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    size?: [number, number, number]
  ) => void;
  readonly onApplyTransform: (
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    size?: [number, number, number]
  ) => void;
  readonly onReplaceStructuralPart: (
    partId: string,
    catalogueId: StructuralCatalogueId
  ) => void;
  readonly onDuplicatePart: (partId: string) => void;
  readonly onAttachPart: (
    childId: string,
    parentId: string,
    parentInterfaceId?: string,
    childInterfaceId?: string
  ) => void;
  readonly onDetachPart: (childId: string) => void;
  readonly onDeletePart: (partId: string) => void;
  readonly onUpdateImportedConfig?: (
    partId: string,
    patch: {
      transform?: Partial<ImportedMeshTransform>;
      engineering?: Partial<ImportedEngineeringProperties>;
      collision?: CustomCollisionConfig;
    }
  ) => void;
  readonly onAddCustomInterface?: (
    partId: string,
    iface: AttachmentInterface
  ) => void;
  readonly onRemoveCustomInterface?: (partId: string, ifaceId: string) => void;
  readonly electricalConnections?: readonly ElectricalConnection[];
  readonly onRemoveElectricalConnection?: (connectionId: string) => void;
}

function roundTo(val: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

function serializeTransformSignature(
  pos: readonly [number, number, number],
  rot: readonly [number, number, number],
  size: readonly [number, number, number]
): string {
  return `${pos[0].toFixed(5)},${pos[1].toFixed(5)},${pos[2].toFixed(5)}|${rot[0].toFixed(5)},${rot[1].toFixed(5)},${rot[2].toFixed(5)}|${size[0].toFixed(5)},${size[1].toFixed(5)},${size[2].toFixed(5)}`;
}

export default function PartInspectorPanel({
  part,
  parts,
  connections,
  foundation,
  diagnostics,
  onPreviewTransform,
  onApplyTransform,
  onReplaceStructuralPart,
  onDuplicatePart,
  onAttachPart,
  onDetachPart,
  onDeletePart,
  onUpdateImportedConfig,
  onAddCustomInterface,
  onRemoveCustomInterface,
  electricalConnections = [],
  onRemoveElectricalConnection,
}: PartInspectorPanelProps) {
  const [newIfaceLabel, setNewIfaceLabel] = useState("Custom Mount");
  const [newIfaceCategory, setNewIfaceCategory] = useState<
    NonNullable<AttachmentInterface["interfaceCategory"]>
  >("generic");
  const [newIfacePos, setNewIfacePos] = useState<[number, number, number]>([0, 0.1, 0]);
  const currentExtents = getPartBoxExtents(part);
  const partRot = part.rotation ?? ([0, 0, 0] as const);
  const currentSignature = serializeTransformSignature(
    part.position,
    partRot,
    currentExtents
  );

  const [baseline, setBaseline] = useState<{
    position: [number, number, number];
    rotation: [number, number, number];
    size: [number, number, number];
  }>(() => ({
    position: [...part.position],
    rotation: [...partRot],
    size: [...currentExtents],
  }));

  const [draftPos, setDraftPos] = useState<[number, number, number]>(
    () => [...part.position]
  );
  const [draftRotDeg, setDraftRotDeg] = useState<[number, number, number]>(
    () => [
      roundTo(partRot[0] * RAD_TO_DEG, 1),
      roundTo(partRot[1] * RAD_TO_DEG, 1),
      roundTo(partRot[2] * RAD_TO_DEG, 1),
    ]
  );
  const [draftSize, setDraftSize] = useState<[number, number, number]>(
    () => [...currentExtents]
  );
  const [isDirty, setIsDirty] = useState(false);

  const isDirtyRef = useRef(isDirty);
  const baselineRef = useRef(baseline);
  const applyingRef = useRef(false);
  const expectedPreviewSigRef = useRef<string | null>(null);
  const previewCallbackRef = useRef(onPreviewTransform);

  useEffect(() => {
    isDirtyRef.current = isDirty;
    baselineRef.current = baseline;
    previewCallbackRef.current = onPreviewTransform;
  }, [isDirty, baseline, onPreviewTransform]);

  // Synchronize draft/baseline when transform changes externally (e.g., undo/redo or gizmo commit)
  useEffect(() => {
    if (
      expectedPreviewSigRef.current &&
      expectedPreviewSigRef.current === currentSignature
    ) {
      return;
    }
    expectedPreviewSigRef.current = null;
    setBaseline({
      position: [...part.position],
      rotation: [...partRot],
      size: [...currentExtents],
    });
    setDraftPos([...part.position]);
    setDraftRotDeg([
      roundTo(partRot[0] * RAD_TO_DEG, 1),
      roundTo(partRot[1] * RAD_TO_DEG, 1),
      roundTo(partRot[2] * RAD_TO_DEG, 1),
    ]);
    setDraftSize([...currentExtents]);
    setIsDirty(false);
  }, [currentSignature, part.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Revert unapplied live preview cleanly when switching parts or unmounting inspector
  const revertPreviewDims =
    !part.id.startsWith("foundation-") &&
    part.type !== "Battery" &&
    part.type !== "Controller" &&
    part.type !== "Motor" &&
    part.type !== "Wheel";
  useEffect(() => {
    const activePartId = part.id;
    return () => {
      if (isDirtyRef.current && !applyingRef.current) {
        const base = baselineRef.current;
        previewCallbackRef.current(
          activePartId,
          base.position,
          base.rotation,
          revertPreviewDims ? base.size : undefined
        );
      }
    };
  }, [part.id, revertPreviewDims]);

  const activeConnection = connections.find(
    (conn) => (conn.childId ?? conn.targetId) === part.id
  );
  const currentParent = activeConnection
    ? parts.find((p) => p.id === (activeConnection.parentId ?? activeConnection.sourceId))
    : undefined;

  const validAttachParents = useMemo(
    () =>
      parts.filter(
        (candidate) =>
          candidate.id !== part.id &&
          candidate.type !== "Wheel" &&
          !hasAttachmentCycle(
            connections.filter((c) => (c.childId ?? c.targetId) !== part.id),
            candidate.id,
            part.id
          )
      ),
    [parts, connections, part.id]
  );

  const [targetParentId, setTargetParentId] = useState<string>(
    currentParent?.id ?? validAttachParents[0]?.id ?? "foundation-chassis"
  );
  const chosenParent =
    validAttachParents.find((p) => p.id === targetParentId) ??
    validAttachParents[0] ??
    null;

  const parentInterfaces = useMemo(
    () =>
      chosenParent
        ? resolvePartMountingInterfaces(chosenParent, foundation)
        : [],
    [chosenParent, foundation]
  );
  const childInterfaces = useMemo(
    () => resolvePartMountingInterfaces(part, foundation),
    [part, foundation]
  );

  const [targetParentIfaceId, setTargetParentIfaceId] = useState<string>(
    activeConnection?.parentMountPointId ?? parentInterfaces[0]?.id ?? ""
  );
  const [targetChildIfaceId, setTargetChildIfaceId] = useState<string>(
    activeConnection?.childMountPointId ?? childInterfaces[0]?.id ?? ""
  );

  const selectedParentIface =
    parentInterfaces.find((i) => i.id === targetParentIfaceId) ??
    parentInterfaces[0] ??
    null;
  const selectedChildIface =
    childInterfaces.find((i) => i.id === targetChildIfaceId) ??
    childInterfaces[0] ??
    null;

  const compatibility = useMemo(() => {
    if (!chosenParent) return null;
    return evaluateComponentAttachmentCompatibility({
      childPart: part,
      parentPart: chosenParent,
      parentInterface: selectedParentIface,
      childInterface: selectedChildIface,
      foundation,
      existingConnections: connections,
    });
  }, [part, chosenParent, selectedParentIface, selectedChildIface, foundation, connections]);

  const specializedEvaluation = useMemo(() => {
    if (part.type === "Motor") {
      return evaluateMotorMountCompatibility({
        motor: part,
        parentPart: currentParent,
        foundation,
      });
    }
    if (part.type === "Wheel") {
      return evaluateMotorWheelCompatibility({
        motor: currentParent,
        wheel: part,
        foundation,
      });
    }
    return null;
  }, [part, currentParent, foundation]);

  const attachedChildrenCount = useMemo(
    () =>
      connections.filter((c) => (c.parentId ?? c.sourceId) === part.id).length,
    [connections, part.id]
  );

  const isFoundationRoot = part.id === "foundation-chassis";
  const isLockedDriveComponent =
    Boolean(activeConnection) && (part.type === "Motor" || part.type === "Wheel");
  const canEditTransform = !isFoundationRoot && !isLockedDriveComponent;
  const canEditDimensions =
    !part.id.startsWith("foundation-") &&
    part.type !== "Battery" &&
    part.type !== "Controller" &&
    part.type !== "Motor" &&
    part.type !== "Wheel";
  const canDuplicate = canEditDimensions;

  const toRadTuple = (deg: [number, number, number]): [number, number, number] => [
    deg[0] * DEG_TO_RAD,
    deg[1] * DEG_TO_RAD,
    deg[2] * DEG_TO_RAD,
  ];

  const triggerPreview = (
    nextPos: [number, number, number],
    nextDeg: [number, number, number],
    nextSize: [number, number, number]
  ) => {
    const nextRot = toRadTuple(nextDeg);
    const effectiveSize = canEditDimensions ? nextSize : baselineRef.current.size;
    expectedPreviewSigRef.current = serializeTransformSignature(
      nextPos,
      nextRot,
      effectiveSize
    );
    setIsDirty(true);
    onPreviewTransform(
      part.id,
      nextPos,
      nextRot,
      canEditDimensions ? nextSize : undefined
    );
  };

  const handlePosChange = (axis: 0 | 1 | 2, val: number) => {
    if (!Number.isFinite(val)) return;
    const next: [number, number, number] = [...draftPos];
    next[axis] = roundTo(val, 3);
    setDraftPos(next);
    triggerPreview(next, draftRotDeg, draftSize);
  };

  const handleRotChange = (axis: 0 | 1 | 2, degVal: number) => {
    if (!Number.isFinite(degVal)) return;
    const next: [number, number, number] = [...draftRotDeg];
    next[axis] = roundTo(degVal, 1);
    setDraftRotDeg(next);
    triggerPreview(draftPos, next, draftSize);
  };

  const handleSizeChange = (axis: 0 | 1 | 2, val: number) => {
    if (!Number.isFinite(val) || val < 0.01) return;
    const next: [number, number, number] = [...draftSize];
    next[axis] = roundTo(val, 3);
    setDraftSize(next);
    triggerPreview(draftPos, draftRotDeg, next);
  };

  const handleApply = () => {
    applyingRef.current = true;
    const nextRot = toRadTuple(draftRotDeg);
    const nextSz = canEditDimensions ? draftSize : undefined;
    expectedPreviewSigRef.current = serializeTransformSignature(
      draftPos,
      nextRot,
      nextSz ?? baseline.size
    );
    // Restore baseline cleanly before recording one undoable commit
    onPreviewTransform(
      part.id,
      baseline.position,
      baseline.rotation,
      canEditDimensions ? baseline.size : undefined
    );
    onApplyTransform(part.id, draftPos, nextRot, nextSz);
    setBaseline({
      position: [...draftPos],
      rotation: [...nextRot],
      size: [...(nextSz ?? baseline.size)],
    });
    setIsDirty(false);
    applyingRef.current = false;
  };

  const handleCancel = () => {
    expectedPreviewSigRef.current = null;
    onPreviewTransform(
      part.id,
      baseline.position,
      baseline.rotation,
      canEditDimensions ? baseline.size : undefined
    );
    setDraftPos([...baseline.position]);
    setDraftRotDeg([
      roundTo(baseline.rotation[0] * RAD_TO_DEG, 1),
      roundTo(baseline.rotation[1] * RAD_TO_DEG, 1),
      roundTo(baseline.rotation[2] * RAD_TO_DEG, 1),
    ]);
    setDraftSize([...baseline.size]);
    setIsDirty(false);
  };

  const handleResetPosition = () => {
    const resetPos: [number, number, number] = [
      0,
      roundTo(draftSize[1] * 0.5 + (foundation?.height ?? 0.35), 3),
      0,
    ];
    setDraftPos(resetPos);
    triggerPreview(resetPos, draftRotDeg, draftSize);
  };

  const handleResetRotation = () => {
    const resetDeg: [number, number, number] = [0, 0, 0];
    setDraftRotDeg(resetDeg);
    triggerPreview(draftPos, resetDeg, draftSize);
  };

  return (
    <div className="workshop-part-inspector">
      <div className="object-card">
        <div className="object-icon">⊞</div>
        <div>
          <div className="object-name">{part.name}</div>
          <div className="object-type">
            {part.type}
            {part.structuralCategory ? ` · ${part.structuralCategory}` : ""} ·{" "}
            {(part.massKg ?? part.mass).toFixed(2)} kg
          </div>
        </div>
      </div>

      {isFoundationRoot && (
        <p className="builder-intro">
          Primary foundation anchors the robot origin. Edit dimensions in the Foundation step.
        </p>
      )}
      {isLockedDriveComponent && (
        <p className="builder-intro">
          Zone motors and shaft-mounted wheels follow mounting zone / shaft geometry.
        </p>
      )}

      {canEditTransform && (
        <>
          <div className="sim-inspector-header-row">
            <div className="section-label">POSITION (M)</div>
            <button
              type="button"
              className="sim-clear-selection-btn"
              onClick={handleResetPosition}
            >
              Reset Pos
            </button>
          </div>
          {(["X (Front+)", "Y (Up+)", "Z (Left+)"] as const).map((label, idx) => {
            const axis = idx as 0 | 1 | 2;
            return (
              <div className="workshop-axis-row" key={label}>
                <span>{label}</span>
                <div className="workshop-axis-controls">
                  <button
                    type="button"
                    aria-label={`Decrease ${label}`}
                    onClick={() => handlePosChange(axis, draftPos[axis] - 0.05)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    aria-label={`Position ${label}`}
                    step={0.05}
                    value={draftPos[axis]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) handlePosChange(axis, v);
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Increase ${label}`}
                    onClick={() => handlePosChange(axis, draftPos[axis] + 0.05)}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}

          <div className="sim-inspector-header-row">
            <div className="section-label">ROTATION (DEG)</div>
            <button
              type="button"
              className="sim-clear-selection-btn"
              onClick={handleResetRotation}
            >
              Reset Rot
            </button>
          </div>
          {(["Rx (Roll)", "Ry (Yaw)", "Rz (Pitch)"] as const).map((label, idx) => {
            const axis = idx as 0 | 1 | 2;
            return (
              <div className="workshop-axis-row" key={label}>
                <span>{label}</span>
                <div className="workshop-axis-controls">
                  <button
                    type="button"
                    aria-label={`Decrease ${label}`}
                    onClick={() => handleRotChange(axis, draftRotDeg[axis] - 15)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    aria-label={`Rotation ${label}`}
                    step={5}
                    value={draftRotDeg[axis]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) handleRotChange(axis, v);
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Increase ${label}`}
                    onClick={() => handleRotChange(axis, draftRotDeg[axis] + 15)}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}

          {canEditDimensions && (
            <>
              <div className="section-label">DIMENSIONS (M)</div>
              {(["Length (X)", "Height (Y)", "Width (Z)"] as const).map(
                (label, idx) => {
                  const axis = idx as 0 | 1 | 2;
                  return (
                    <div className="workshop-axis-row" key={label}>
                      <span>{label}</span>
                      <div className="workshop-axis-controls">
                        <button
                          type="button"
                          aria-label={`Decrease ${label}`}
                          onClick={() =>
                            handleSizeChange(
                              axis,
                              Math.max(0.02, draftSize[axis] - 0.05)
                            )
                          }
                        >
                          −
                        </button>
                        <input
                          type="number"
                          aria-label={label}
                          min={0.02}
                          step={0.02}
                          value={draftSize[axis]}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v >= 0.01) {
                              handleSizeChange(axis, v);
                            }
                          }}
                        />
                        <button
                          type="button"
                          aria-label={`Increase ${label}`}
                          onClick={() =>
                            handleSizeChange(axis, draftSize[axis] + 0.05)
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </>
          )}

          {isDirty && (
            <div className="workshop-preview-bar" role="status">
              <span>Live preview active</span>
              <div className="workshop-inline-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleApply}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleCancel}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {!isFoundationRoot && (
        <div className="workshop-mount-target">
          <div className="section-label">ATTACHMENT &amp; MOUNTING</div>
          <div className="property-row">
            <span>Status</span>
            <span>
              {currentParent
                ? `Mounted to ${currentParent.name}`
                : "Unattached (Free)"}
            </span>
          </div>
          {validAttachParents.length > 0 && part.type !== "Wheel" && (
            <>
              <label className="sim-select-field">
                <span>Parent Component</span>
                <select
                  aria-label="Attachment parent component"
                  value={chosenParent?.id ?? ""}
                  onChange={(e) => {
                    setTargetParentId(e.target.value);
                    setTargetParentIfaceId("");
                  }}
                >
                  {validAttachParents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              {parentInterfaces.length > 0 && (
                <label className="sim-select-field">
                  <span>Parent Interface</span>
                  <select
                    aria-label="Parent attachment interface"
                    value={selectedParentIface?.id ?? ""}
                    onChange={(e) => setTargetParentIfaceId(e.target.value)}
                  >
                    {parentInterfaces.map((iface) => (
                      <option key={iface.id} value={iface.id}>
                        {iface.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {childInterfaces.length > 0 && (
                <label className="sim-select-field">
                  <span>Part Mounting Interface</span>
                  <select
                    aria-label="Child attachment interface"
                    value={selectedChildIface?.id ?? ""}
                    onChange={(e) => setTargetChildIfaceId(e.target.value)}
                  >
                    {childInterfaces.map((iface) => (
                      <option key={iface.id} value={iface.id}>
                        {iface.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {compatibility && (
                <>
                  <div
                    className={`workshop-compat-pill ${compatibility.status}`}
                    title={compatibility.summary}
                  >
                    Compatibility: {compatibility.status.replace(/-/g, " ").toUpperCase()} ({compatibility.provenanceState})
                  </div>
                  <div className="workshop-compat-checks">
                    {compatibility.checks.map((chk) => (
                      <div key={chk.id} className={`workshop-compat-check-row ${chk.status}`}>
                        <span>{chk.message}</span>
                        {chk.correctiveAction && (
                          <small className="workshop-compat-hint">{chk.correctiveAction}</small>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="workshop-inline-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!chosenParent}
                  onClick={() => {
                    if (!chosenParent) return;
                    onAttachPart(
                      part.id,
                      chosenParent.id,
                      selectedParentIface?.id,
                      selectedChildIface?.id
                    );
                  }}
                >
                  {activeConnection ? "Re-attach" : "Attach to Parent"}
                </button>
                {activeConnection && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onDetachPart(part.id)}
                  >
                    Detach
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {specializedEvaluation && (
        <div className="workshop-mount-target">
          <div className="section-label">
            {part.type === "Motor" ? "MOTOR MOUNT INTELLIGENCE" : "WHEEL-SHAFT COUPLING"}
          </div>
          <div className={`workshop-compat-pill ${specializedEvaluation.status}`}>
            {specializedEvaluation.status.replace(/-/g, " ").toUpperCase()} ·{" "}
            {specializedEvaluation.provenanceState}
          </div>
          <div className="workshop-compat-checks">
            {specializedEvaluation.checks.map((chk) => (
              <div key={chk.id} className={`workshop-compat-check-row ${chk.status}`}>
                <span>{chk.message}</span>
                {chk.assumption && (
                  <small className="workshop-compat-hint">Assumption: {chk.assumption}</small>
                )}
                {chk.correctiveAction && (
                  <small className="workshop-compat-hint">Hint: {chk.correctiveAction}</small>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {canEditDimensions && part.structuralCatalogueId && (
        <div className="workshop-mount-target">
          <label className="sim-select-field">
            <span>Replace Structural Variant</span>
            <select
              aria-label="Replace structural component"
              value={part.structuralCatalogueId}
              onChange={(e) =>
                onReplaceStructuralPart(
                  part.id,
                  e.target.value as StructuralCatalogueId
                )
              }
            >
              {structuralCatalogue.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {attachedChildrenCount > 0 && (
            <small className="builder-intro" style={{ display: "block", marginTop: 4 }}>
              {attachedChildrenCount} mounted child component(s) will be re-evaluated &amp; re-aligned on replacement.
            </small>
          )}
        </div>
      )}

      {part.meshAssetId && onUpdateImportedConfig && (
        <div className="workshop-mount-target">
          <div className="section-label">IMPORTED STL ENGINEERING</div>
          <label className="sim-select-field">
            <span>Material</span>
            <select
              aria-label="Part imported material"
              value={part.importedEngineering?.materialId ?? "unknown"}
              onChange={(e) =>
                onUpdateImportedConfig(part.id, {
                  engineering: { materialId: e.target.value as ImportedMaterialId },
                })
              }
            >
              {IMPORTED_MATERIAL_PRESETS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="sim-select-field">
            <span>Mass Mode</span>
            <select
              aria-label="Part imported mass mode"
              value={part.importedEngineering?.massMode ?? "unknown"}
              onChange={(e) =>
                onUpdateImportedConfig(part.id, {
                  engineering: { massMode: e.target.value as ImportedMassMode },
                })
              }
            >
              <option value="unknown">Unknown</option>
              <option value="user">User-Entered (kg)</option>
              <option value="estimated-density">Estimated (Volume × Density)</option>
            </select>
          </label>
          {part.importedEngineering?.massMode === "user" && (
            <div className="property-row">
              <span>User Mass (kg)</span>
              <input
                type="number"
                step={0.1}
                min={0.01}
                value={part.importedEngineering.massKg ?? 1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) {
                    onUpdateImportedConfig(part.id, {
                      engineering: { massKg: v, massMode: "user" },
                    });
                  }
                }}
              />
            </div>
          )}
          {part.collisionConfig && (
            <label className="sim-select-field">
              <span>Collision Proxy</span>
              <select
                aria-label="Part collision mode"
                value={part.collisionConfig.mode}
                onChange={(e) =>
                  onUpdateImportedConfig(part.id, {
                    collision: {
                      ...part.collisionConfig!,
                      mode: e.target.value as CustomCollisionMode,
                    },
                  })
                }
              >
                <option value="bounding-box">Bounding Box</option>
                <option value="single-box">Single Box</option>
                <option value="multi-box">Multi-Box Quadrants</option>
                <option value="convex-approx">Convex Approx</option>
              </select>
            </label>
          )}
        </div>
      )}

      {(part.meshAssetId || part.id === "foundation-chassis") &&
        onAddCustomInterface && (
          <div className="workshop-mount-target">
            <div className="section-label">CUSTOM MOUNTING INTERFACES</div>
            {(part.customMountingInterfaces ?? []).map((iface) => (
              <div className="installed-motor" key={iface.id}>
                <span>
                  {iface.label} ({iface.interfaceCategory ?? iface.kind})
                </span>
                {onRemoveCustomInterface && (
                  <button
                    type="button"
                    className="sim-clear-selection-btn"
                    onClick={() => onRemoveCustomInterface(part.id, iface.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <label className="sim-select-field">
              <span>Interface Label</span>
              <input
                type="text"
                className="workshop-search-input"
                aria-label="Custom interface label"
                value={newIfaceLabel}
                onChange={(e) => setNewIfaceLabel(e.target.value)}
              />
            </label>
            <label className="sim-select-field">
              <span>Interface Role</span>
              <select
                aria-label="Custom interface role"
                value={newIfaceCategory}
                onChange={(e) =>
                  setNewIfaceCategory(
                    e.target.value as NonNullable<AttachmentInterface["interfaceCategory"]>
                  )
                }
              >
                <option value="point">Mounting Point</option>
                <option value="plane">Mounting Plane</option>
                <option value="pattern">Mounting Pattern Anchor</option>
                <option value="motor-mount">Motor Mount</option>
                <option value="wheel-mount">Wheel / Axle Mount</option>
                <option value="generic">Generic Structural Interface</option>
              </select>
            </label>
            <div className="workshop-inline-actions">
              {(["X", "Y", "Z"] as const).map((axis, idx) => (
                <label key={axis} className="sim-select-field">
                  <span>{axis} (m)</span>
                  <input
                    type="number"
                    step={0.05}
                    value={newIfacePos[idx]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      const next: [number, number, number] = [...newIfacePos];
                      next[idx] = v;
                      setNewIfacePos(next);
                    }}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              className="secondary-button"
              style={{ marginTop: 6 }}
              onClick={() => {
                const kind =
                  newIfaceCategory === "motor-mount"
                    ? "motor-mount"
                    : newIfaceCategory === "wheel-mount"
                      ? "wheel-hub"
                      : newIfaceCategory === "plane"
                        ? "plate-mount"
                        : "generic-structural";
                const compatWith =
                  kind === "motor-mount"
                    ? (["wheel-hub", "foundation-rail", "rail-slot", "bracket-face"] as const)
                    : kind === "wheel-hub"
                      ? (["motor-mount"] as const)
                      : (["plate-mount", "bracket-face", "rail-slot", "motor-mount", "generic-structural"] as const);
                onAddCustomInterface(part.id, {
                  id: `custom-${crypto.randomUUID().slice(0, 8)}`,
                  label: newIfaceLabel.trim() || "Custom Interface",
                  kind,
                  interfaceCategory: newIfaceCategory,
                  position: [...newIfacePos],
                  rotation: [0, 0, 0],
                  compatibleWith: [...compatWith],
                  compatibilityStatus: "compatible",
                  provenance: {
                    method: "measured",
                    verified: true,
                    source: "user-interface-editor",
                    notes: "User-defined mounting interface on component geometry.",
                  },
                });
              }}
            >
              + Add Interface
            </button>
          </div>
        )}

      <div className="workshop-inline-actions">
        {canDuplicate && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => onDuplicatePart(part.id)}
          >
            Duplicate
          </button>
        )}
        <button
          type="button"
          className="danger-button"
          style={{ marginTop: 10 }}
          onClick={() => onDeletePart(part.id)}
        >
          Remove Part
        </button>
      </div>

      <ElectricalInspectorSection
        part={part}
        parts={parts}
        electricalConnections={electricalConnections}
        onRemoveElectricalConnection={onRemoveElectricalConnection}
      />

      {diagnostics.length > 0 && (
        <div className="workshop-part-diagnostics">
          <div className="section-label">PART DIAGNOSTICS</div>
          {diagnostics.map((d) => (
            <div key={d.id} className={`workshop-diag-item ${d.severity}`}>
              <strong>{d.severity.toUpperCase()}</strong>: {d.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
