import type { Operation as DomainOperation } from "../../core/operations/types.js";
import type { GitInfo } from "../workspace/domain/git.js";
import type { ProcessSnapshot } from "../process/types.js";
import type {
  ComputerDisplay,
  ComputerPermission,
  ComputerSnapshot,
  ComputerStatus,
} from "../computer/types.js";
import type { Workspace } from "../workspace/domain/workspace.js";
import type {
  WorktreeApplyPreview,
  WorktreeFileDiff,
} from "../workspace/domain/review.js";

export type {
  ComputerDisplay,
  ComputerPermission,
  ComputerStatus,
  ProcessSnapshot,
  WorktreeApplyPreview,
  WorktreeFileDiff,
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

export interface WorkspaceView extends Workspace {
  git?: GitInfo | null;
}
