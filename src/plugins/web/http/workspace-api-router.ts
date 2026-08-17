import { Router } from "express";
import type { WebRuntime } from "../runtime.js";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import {
  asyncRoute,
  requireString,
} from "../../../presentation/http/http-utils.js";

export function createWorkspaceApiRouter(application: WebRuntime): Router {
  const router = Router();
  router.get(
    "/workspaces",
    asyncRoute(async (_req, res) => {
      res.json(await application.discoverWorkspaces());
    }),
  );
  router.get(
    "/workspaces/:workspaceId",
    asyncRoute(async (req, res) => {
      const workspaceId = requireString(req.params.workspaceId, "workspaceId");
      const workspace = application.getWorkspace(workspaceId);
      const git = workspace.capabilities.git
        ? await application.gitInfoQuery(workspace.id)
        : null;
      res.json({ ...workspace, git });
    }),
  );
  router.get(
    "/workspaces/:workspaceId/files",
    asyncRoute(async (req, res) => {
      const workspaceId = requireString(req.params.workspaceId, "workspaceId");
      const filePath =
        typeof req.query.path === "string" ? req.query.path : ".";
      const recursive = req.query.recursive === "1";
      res.json(
        await application.listWorkspaceFiles(workspaceId, filePath, recursive),
      );
    }),
  );
  router.get(
    "/workspaces/:workspaceId/file",
    asyncRoute(async (req, res) => {
      const workspaceId = requireString(req.params.workspaceId, "workspaceId");
      const filePath = requireString(req.query.path, "path");
      res.json(
        await application.readWorkspaceFile(
          workspaceId,
          filePath,
          2 * 1024 * 1024,
        ),
      );
    }),
  );
  router.get(
    "/workspaces/:workspaceId/file/image",
    asyncRoute(async (req, res) => {
      const workspaceId = requireString(req.params.workspaceId, "workspaceId");
      const filePath = requireString(req.query.path, "path");
      const mime = imageMime(filePath);
      if (!mime)
        throw new ChatRoomError(
          "INVALID_INPUT",
          "File type is not supported for image preview",
        );
      const file = await application.readWorkspaceFileBytes(
        workspaceId,
        filePath,
        10 * 1024 * 1024,
      );
      if (file.truncated)
        throw new ChatRoomError(
          "INVALID_INPUT",
          "Image is too large to preview",
        );
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", String(file.data.byteLength));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(file.data);
    }),
  );
  router.get(
    "/workspaces/:workspaceId/worktree/diff",
    asyncRoute(async (req, res) => {
      res.json(
        await application.previewWorktreeApply(
          requireString(req.params.workspaceId, "workspaceId"),
        ),
      );
    }),
  );
  router.get(
    "/workspaces/:workspaceId/worktree/diff/file",
    asyncRoute(async (req, res) => {
      const workspaceId = requireString(req.params.workspaceId, "workspaceId");
      res.json(
        await application.previewWorktreeFileDiff(
          workspaceId,
          requireString(req.query.path, "path"),
        ),
      );
    }),
  );
  router.post(
    "/workspaces/:workspaceId/worktree/apply",
    asyncRoute(async (req, res) => {
      const workspaceId = requireString(req.params.workspaceId, "workspaceId");
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (
        body.paths !== undefined &&
        (!Array.isArray(body.paths) ||
          body.paths.some((value) => typeof value !== "string"))
      )
        throw new ChatRoomError(
          "INVALID_INPUT",
          "paths must be an array of file paths",
        );
      res.json(
        await application.applyWorktree(
          workspaceId,
          body.paths as string[] | undefined,
        ),
      );
    }),
  );
  return router;
}

function imageMime(filePath: string): string | null {
  const extension = filePath.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    default:
      return null;
  }
}
