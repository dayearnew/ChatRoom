import type { Operation as DomainOperation } from "../../core/operations/types.js";
import type {
  GitBranch,
  GitChange,
  GitCommit,
  GitDiff,
  GitStatus,
} from "../git/types.js";
import type { ProcessSnapshot } from "../process/types.js";
import type {
  ComputerDisplay,
  ComputerPermission,
  ComputerSnapshot,
  ComputerStatus,
} from "../computer/types.js";
import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceInfo,
  WorkspaceSkill,
} from "../workspace/types.js";

export type {
  ComputerDisplay,
  ComputerPermission,
  ComputerStatus,
  GitBranch,
  GitChange,
  GitCommit,
  GitDiff,
  GitStatus,
  ProcessSnapshot,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceInfo,
  WorkspaceSkill,
};

export interface ComputerPreviewView {
  snapshotId: string;
  revision: number;
  capturedAt: string | null;
  display: ComputerDisplay | null;
  activeApp: string | null;
  activeWindow: string | null;
  cursor: { x: number; y: number } | null;
  elementCount: number;
  screenshot: ComputerSnapshot["screenshot"] | null;
}

export type Operation = DomainOperation;

export interface AuthStatus {
  authenticated: boolean;
  passkeyAvailable: boolean;
  passkeyRegistered: boolean;
}

export interface PasskeySummary {
  id: string;
  name: string;
  lastUsedAt: string;
}

export interface RuntimeStatus {
  version: string;
  mcpRequests: number;
  uptimeMinutes: number;
}

export interface UpdateStatus {
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

export interface McpToolSummary {
  name: string;
  pluginId: string;
  title: string;
  description: string;
  enabled: boolean;
}

export type CloudService = "remote_mcp" | "remote_web";

export interface CloudStatus {
  installationId: string | null;
  customerId: string | null;
  publicPrefix: string | null;
  desiredServices: Record<CloudService, boolean>;
  entitlements: Array<{
    service: CloudService;
    status: "active";
    sourceProvider: string;
    sourceId: string;
    validUntil: string | null;
  }>;
  managementSessionActive: boolean;
  connection:
    "inactive" | "connecting" | "connected" | "disconnected" | "error";
  mcpUrl: string | null;
  webUrl: string | null;
  lastError: string | null;
}
export interface WorkspaceFileContent {
  content: string;
}

export interface CloudManagementSession {
  url: string;
}

export interface CloudRestoreResult {
  status: CloudStatus;
}

export type SystemLogLevel = "debug" | "info" | "warn" | "error";

export interface SystemLogRecord {
  id: string;
  timestamp: string;
  level: SystemLogLevel;
  module: string;
  event: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SystemLogPage {
  items: SystemLogRecord[];
  nextBefore: string | null;
}
