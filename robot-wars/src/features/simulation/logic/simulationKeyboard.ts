const INTERACTIVE_CONTROL_SELECTOR =
  'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"]';

const EDITABLE_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

export interface KeyboardShortcutTargetLike {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly closest?: (selector: string) => unknown;
  readonly getAttribute?: (name: string) => string | null;
}

export interface KeyboardShortcutEventLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly target: EventTarget | KeyboardShortcutTargetLike | null;
}

export function isEditableEventTarget(
  target: EventTarget | KeyboardShortcutTargetLike | null
): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as KeyboardShortcutTargetLike;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return Boolean(el.closest?.(EDITABLE_TARGET_SELECTOR));
}

export function isInteractiveControlTarget(
  target: EventTarget | KeyboardShortcutTargetLike | null
): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as KeyboardShortcutTargetLike;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "BUTTON" || tag === "SUMMARY") return true;
  const role = el.getAttribute?.("role")?.toLowerCase();
  if (
    role === "button" ||
    role === "tab" ||
    role === "menuitem" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "switch"
  ) {
    return true;
  }
  return Boolean(el.closest?.(INTERACTIVE_CONTROL_SELECTOR));
}

/**
 * Determines whether SimulationView's global drive/emergency-stop keyboard handler
 * should intercept a keydown event. Preserves text editing in inputs and prevents
 * global `Space` stop from hijacking normal keyboard button/tab/control activation.
 */
export function shouldHandleSimulationDriveShortcut(
  event: KeyboardShortcutEventLike
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isEditableEventTarget(event.target)) return false;

  const isSpace = event.code === "Space" || event.key === " ";
  if (isSpace && isInteractiveControlTarget(event.target)) {
    return false;
  }

  return true;
}
