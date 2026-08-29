import type {
  ComputerAction,
  ComputerActionResult,
  ComputerSnapshot,
} from "./types.js";

export function auditComputerActions(input: {
  snapshotId?: string;
  actions: ComputerAction[];
  observeAfter?: boolean;
}) {
  return {
    snapshotId: input.snapshotId ?? null,
    observeAfter: input.observeAfter ?? true,
    actions: input.actions.map((action) => sanitizeAction(action)),
  };
}

function sanitizeAction(action: ComputerAction): unknown {
  if (action.type === "type_text")
    return {
      type: action.type,
      characters: action.text.length,
      elementId: action.elementId ?? null,
    };
  if (action.type === "set_value")
    return {
      type: action.type,
      characters: action.value.length,
      elementId: action.elementId,
    };
  return action;
}

export function auditSnapshotOutput(value: ComputerSnapshot) {
  return {
    snapshotId: value.snapshotId,
    revision: value.revision,
    display: value.display,
    activeApp: value.activeApp,
    activeWindow: value.activeWindow,
    elementCount: value.elements.length,
    screenshot: Boolean(value.screenshot),
  };
}

export function auditActionOutput(value: ComputerActionResult) {
  return {
    success: value.success,
    revision: value.revision,
    executionMode: value.executionMode,
    focusChanged: value.focusChanged,
    snapshot: value.snapshot ? auditSnapshotOutput(value.snapshot) : null,
  };
}
