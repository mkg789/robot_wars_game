import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { AssemblyValidationReport } from "../../features/robot-builder/logic/assemblyValidation";
import type {
  DrivetrainConfiguration,
  RobotConnection,
  RobotPart,
} from "../../features/robot-builder/types/robot.types";
import { VisibilityIcon } from "./WorkshopSharedControls";

export interface AssemblyHierarchyTreeProps {
  readonly parts: RobotPart[];
  readonly connections: RobotConnection[];
  readonly drivetrain: DrivetrainConfiguration;
  readonly childrenByParent: Map<string, RobotPart[]>;
  readonly anchoredRootParts: RobotPart[];
  readonly unattachedRootParts: RobotPart[];
  readonly hiddenPartIdSet: Set<string>;
  readonly collapsedPartIds: Set<string>;
  readonly setCollapsedPartIds: Dispatch<SetStateAction<Set<string>>>;
  readonly selectedId: string | null;
  readonly validationReport: AssemblyValidationReport;
  readonly onSelectPart: (partId: string) => void;
  readonly onToggleVisibility: (partId: string) => void;
  readonly onDeletePart: (partId: string) => void;
}

export function AssemblyHierarchyTree({
  parts,
  connections,
  drivetrain,
  childrenByParent,
  anchoredRootParts,
  unattachedRootParts,
  hiddenPartIdSet,
  collapsedPartIds,
  setCollapsedPartIds,
  selectedId,
  validationReport,
  onSelectPart,
  onToggleVisibility,
  onDeletePart,
}: AssemblyHierarchyTreeProps) {
  const renderHierarchy = (partId: string, depth = 0): ReactNode => {
    const part = parts.find((item) => item.id === partId);
    if (!part) return null;
    const children = childrenByParent.get(part.id) ?? [];
    const hasChildren = children.length > 0;
    const expanded = hasChildren && !collapsedPartIds.has(part.id);
    const visible = !hiddenPartIdSet.has(part.id);
    const partDiags = validationReport.diagnosticsByPartId[part.id] ?? [];
    const hasError = partDiags.some((d) => d.severity === "error");
    const hasWarning = partDiags.some((d) => d.severity === "warning");
    const hasUnknown = partDiags.some((d) => d.isUnknownAssumption);

    let roleBadge: string | null = null;
    if (part.id === "foundation-chassis") {
      roleBadge = part.meshAssetId ? "STL-Root" : "Root";
    } else if (part.foundationMemberRole) {
      roleBadge =
        part.foundationMemberRole === "rail"
          ? "Rail"
          : part.foundationMemberRole === "crossmember"
            ? "Cross"
            : part.foundationMemberRole === "plate"
              ? "Plate"
              : part.foundationMemberRole === "flange"
                ? "Flange"
                : "Member";
    } else if (part.meshAssetId) {
      roleBadge = "STL";
    } else if (part.type === "Motor") {
      const inLeft = drivetrain.left.some((a) => a?.motorId === part.id);
      const inRight = drivetrain.right.some((a) => a?.motorId === part.id);
      roleBadge = inLeft ? "L-Drive" : inRight ? "R-Drive" : part.mountingZoneId ? "Zone" : "Struct";
    } else if (part.type === "Wheel") {
      const hasShaftLink = connections.some(
        (c) => c.type === "Motor-Wheel" && (c.childId ?? c.targetId) === part.id
      );
      const inLeft = drivetrain.left.some((a) => a?.wheelId === part.id);
      const inRight = drivetrain.right.some((a) => a?.wheelId === part.id);
      roleBadge = inLeft ? "L-Wheel" : inRight ? "R-Wheel" : hasShaftLink ? "Shaft" : "Free";
    } else if (
      part.id !== "foundation-top-plate" &&
      part.id !== "foundation-front-cover" &&
      !connections.some((c) => (c.childId ?? c.targetId) === part.id)
    ) {
      roleBadge = "Unattached";
    }

    return (
      <div key={part.id}>
        <div
          className={`tree-item ${
            selectedId === part.id ? "selected" : ""
          } ${hasError ? "has-error" : hasWarning ? "has-warning" : ""}`}
          style={{ paddingLeft: `${10 + depth * 14}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="tree-expand"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${part.name}`}
              aria-expanded={expanded}
              onClick={() =>
                setCollapsedPartIds((current) => {
                  const next = new Set(current);
                  if (next.has(part.id)) next.delete(part.id);
                  else next.add(part.id);
                  return next;
                })
              }
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="tree-expand-spacer" aria-hidden="true" />
          )}
          <button
            type="button"
            className="tree-select"
            aria-label={`Select ${part.name}`}
            aria-pressed={selectedId === part.id}
            onClick={() => onSelectPart(part.id)}
          >
            <span className="tree-icon" aria-hidden="true">▣</span>
            <span className="tree-label">{part.name}</span>
            {roleBadge && (
              <span className={`tree-role-tag ${roleBadge === "Unattached" || roleBadge === "Free" ? "free" : ""}`}>
                {roleBadge}
              </span>
            )}
          </button>
          {(hasError || hasWarning || hasUnknown) && (
            <span
              className={`tree-diag-badge ${hasError ? "error" : hasWarning ? "warning" : "unknown"}`}
              title={partDiags.map((d) => d.message).join("\n")}
            >
              {hasError ? "✕" : hasWarning ? "!" : "?"}
            </span>
          )}
          <button
            type="button"
            className={`tree-visibility ${visible ? "visible" : "hidden"}`}
            aria-label={`${visible ? "Hide" : "Show"} ${part.name}`}
            aria-pressed={!visible}
            title={`${visible ? "Hide" : "Show"} ${part.name}`}
            onClick={() => onToggleVisibility(part.id)}
          >
            <VisibilityIcon visible={visible} />
          </button>
          {part.id !== "foundation-chassis" && (
            <button
              type="button"
              className="tree-remove-btn"
              aria-label={`Remove ${part.name}`}
              title={`Remove ${part.name}`}
              onClick={() => onDeletePart(part.id)}
            >
              ×
            </button>
          )}
        </div>
        {expanded &&
          children.map((child) => renderHierarchy(child.id, depth + 1))}
      </div>
    );
  };

  return (
    <div className="panel-content">
      <div className="section-label">
        ASSEMBLY HIERARCHY
      </div>

      {anchoredRootParts.map((part) => renderHierarchy(part.id))}

      {unattachedRootParts.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 10 }}>
            UNATTACHED COMPONENTS ({unattachedRootParts.length})
          </div>
          {unattachedRootParts.map((part) => renderHierarchy(part.id))}
        </>
      )}
    </div>
  );
}
