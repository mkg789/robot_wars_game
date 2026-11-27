import type { RobotConnection, RobotPart } from "../types/robot.types";

export interface TabKeyboardEventLike {
  readonly key: string;
  readonly preventDefault: () => void;
  readonly currentTarget?: {
    readonly parentElement?: {
      readonly querySelectorAll: (selector: string) => ArrayLike<unknown>;
    } | null;
  } | null;
}

export interface DestructiveDeleteConfirmation {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
}

/**
 * Determines whether deleting `partId` causes a cascading or structural removal that
 * warrants an explicit user confirmation modal before applying `deletePartById`.
 */
export function assessDestructivePartDelete(
  partId: string,
  parts: readonly RobotPart[],
  connections: readonly RobotConnection[],
  foundationId = "foundation-chassis"
): DestructiveDeleteConfirmation | null {
  const target = parts.find((part) => part.id === partId);
  if (!target) return null;

  if (partId === foundationId || target.foundationMemberRole) {
    return {
      title: "Delete foundation assembly?",
      description: `Removing "${target.name}" will unconfirm or tear down the foundation structure and any assemblies mounted to it.`,
      confirmLabel: "Delete Foundation",
    };
  }

  const mountedWheelIds =
    target.type === "Motor"
      ? connections
          .filter(
            (conn) =>
              conn.type === "Motor-Wheel" &&
              (conn.parentId ?? conn.sourceId) === partId
          )
          .map((conn) => conn.childId ?? conn.targetId)
      : [];

  if (mountedWheelIds.length > 0) {
    return {
      title: "Delete motor and mounted wheel?",
      description: `Removing "${target.name}" will also remove ${mountedWheelIds.length} wheel(s) mounted to its shaft.`,
      confirmLabel: "Delete Motor",
    };
  }

  const childConnections = connections.filter(
    (conn) => (conn.parentId ?? conn.sourceId) === partId
  );
  if (childConnections.length > 0) {
    return {
      title: "Delete part with mounted subassemblies?",
      description: `"${target.name}" has ${childConnections.length} attached child part(s) that will be detached when deleted.`,
      confirmLabel: "Delete Part",
    };
  }

  return null;
}

/**
 * Handles ArrowLeft / ArrowRight / Home / End keyboard navigation for ARIA `tablist` controls,
 * activating the next/previous tab and moving DOM focus to its button element.
 */
export function handleTabListKeyDown<T extends string>(
  event: TabKeyboardEventLike,
  tabKeys: readonly T[],
  activeKey: T,
  onSelect: (nextKey: T) => void
): T | null {
  const currentIndex = tabKeys.indexOf(activeKey);
  if (currentIndex === -1 || tabKeys.length === 0) return null;

  let nextIndex: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      nextIndex = (currentIndex + 1) % tabKeys.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      nextIndex = (currentIndex - 1 + tabKeys.length) % tabKeys.length;
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = tabKeys.length - 1;
      break;
    default:
      return null;
  }

  event.preventDefault();
  const nextKey = tabKeys[nextIndex];
  onSelect(nextKey);

  const tabNodes = event.currentTarget?.parentElement?.querySelectorAll('[role="tab"]');
  const targetNode = tabNodes?.[nextIndex] as { focus?: () => void } | undefined;
  targetNode?.focus?.();
  return nextKey;
}
