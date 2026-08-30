export type ComputerAccessScope = "local" | "remote";
export type ComputerPlatform = "macos" | "windows" | "linux" | "unsupported";
export type ComputerHelperState = "running" | "stopped" | "unavailable";
export type ComputerPermissionState =
  "granted" | "denied" | "unknown" | "not-required";
export type ComputerPermission = "accessibility" | "screenRecording";

export interface ComputerSettings {
  enabled: boolean;
  remoteAccess: boolean;
  updatedAt: string;
}

export interface ComputerPermissions {
  accessibility: ComputerPermissionState;
  screenRecording: ComputerPermissionState;
}

export interface ComputerDisplay {
  id: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

export interface ComputerStatus {
  platform: ComputerPlatform;
  helper: ComputerHelperState;
  permissions: ComputerPermissions;
  displays: ComputerDisplay[];
  settings: ComputerSettings;
}

export interface ComputerElement {
  id: number;
  role: string;
  name: string | null;
  value: string | null;
  enabled: boolean;
  focused: boolean;
  selected: boolean;
  sensitive: boolean;
  bounds: [number, number, number, number] | null;
  actions: string[];
}

export type ComputerSnapshotTarget =
  | { type: "desktop" }
  | { type: "display"; displayId?: string }
  | { type: "app"; app: string }
  | { type: "window"; elementId: number }
  | {
      type: "region";
      displayId?: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };

export interface ComputerSnapshotRequest {
  target?: ComputerSnapshotTarget;
  includeScreenshot: boolean;
  includeElements: boolean;
}

export interface ComputerSnapshot {
  snapshotId: string;
  revision: number;
  display: ComputerDisplay | null;
  activeApp: string | null;
  activeWindow: string | null;
  cursor: { x: number; y: number } | null;
  elements: ComputerElement[];
  screenshot?: { mimeType: "image/jpeg" | "image/png"; data: string };
}

export type ComputerAction =
  | { type: "move"; x: number; y: number }
  | { type: "click"; x?: number; y?: number; elementId?: number }
  | { type: "double_click"; x?: number; y?: number; elementId?: number }
  | { type: "right_click"; x?: number; y?: number; elementId?: number }
  | {
      type: "drag";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
    }
  | { type: "scroll"; deltaX?: number; deltaY: number; elementId?: number }
  | { type: "keypress"; keys: string[] }
  | { type: "type_text"; text: string; elementId?: number }
  | { type: "invoke"; elementId: number }
  | { type: "set_value"; elementId: number; value: string }
  | { type: "select_text"; elementId: number; start: number; length: number }
  | { type: "activate_app"; app: string }
  | { type: "activate_window"; elementId: number }
  | { type: "move_window"; elementId: number; x: number; y: number }
  | { type: "resize_window"; elementId: number; width: number; height: number }
  | { type: "wait"; ms: number };

export interface ComputerActionRequest {
  snapshotId?: string;
  actions: ComputerAction[];
  observeAfter: boolean;
}

export interface ComputerActionResult {
  success: true;
  revision: number;
  snapshot?: ComputerSnapshot;
  executionMode: "semantic" | "background" | "foreground" | "mixed";
  focusChanged: boolean;
}

export interface ComputerBackend {
  status(): Promise<Omit<ComputerStatus, "settings">>;
  requestPermission(
    permission: ComputerPermission,
  ): Promise<Omit<ComputerStatus, "settings">>;
  snapshot(
    request: ComputerSnapshotRequest,
    revision: number,
  ): Promise<ComputerSnapshot>;
  action(
    request: ComputerActionRequest,
    revision: number,
  ): Promise<ComputerActionResult>;
  dispose(): Promise<void>;
}
