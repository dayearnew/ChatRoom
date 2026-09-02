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
  display: ComputerDisplay | null;
  activeApp: string | null;
  activeWindow: string | null;
  cursor: { x: number; y: number } | null;
  elementCount: number;
  screenshot: ComputerSnapshot["screenshot"] | null;
}

export type Operation = DomainOperation;
