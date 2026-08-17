import type { Operation as DomainOperation } from "../../core/operations/types.js";
import type { GitInfo } from "../workspace/domain/git.js";
import type { ProcessSnapshot } from "../process/types.js";
import type { Workspace } from "../workspace/domain/workspace.js";
import type {
  WorktreeApplyPreview,
  WorktreeFileDiff,
} from "../workspace/domain/review.js";

export type { ProcessSnapshot, WorktreeApplyPreview, WorktreeFileDiff };

export type Operation = DomainOperation;

export interface WorkspaceView extends Workspace {
  git?: GitInfo | null;
}
