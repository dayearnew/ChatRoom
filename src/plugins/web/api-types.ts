import type { Operation as DomainOperation } from "#core/operations/types";
import type {
  GitBranch,
  GitChange,
  GitCommit,
  GitDiff,
  GitStatus,
} from "#plugins/git/types";
import type { ProcessSnapshot, ProcessSummary } from "#plugins/process/types";
import type { McpToolSummary as DomainMcpToolSummary } from "#mcp/server/tool-control";
import type {
  CloudServiceId,
  CloudStatus as DomainCloudStatus,
} from "#plugins/cloud/types";
import type {
  ComputerDisplay,
  ComputerPermission,
  ComputerSnapshot,
  ComputerStatus,
} from "#plugins/computer/types";
import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceInfo,
  WorkspaceSkill,
} from "#plugins/workspace/types";

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
  ProcessSummary,
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

export type McpToolSummary = DomainMcpToolSummary;
export type CloudService = CloudServiceId;
export type CloudStatus = DomainCloudStatus;

export interface WorkspaceFileContent {
  content: string;
}

export interface CloudManagementSession {
  url: string;
}

export interface CloudRestoreResult {
  status: CloudStatus;
}

export type { LogLevel, LogPage, LogRecord } from "#core/logging/types";
